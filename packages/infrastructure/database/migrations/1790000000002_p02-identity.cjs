exports.up = (pgm) => {
  pgm.sql(`
    SET LOCAL ROLE db_owner;
    CREATE TABLE levex.actors (
      id uuid PRIMARY KEY,
      display_name varchar(120) NOT NULL CHECK (
        display_name = btrim(display_name) AND char_length(display_name) BETWEEN 1 AND 120),
      status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DEACTIVATED')),
      version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
      created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
      updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
      deactivated_at timestamptz,
      CHECK ((status = 'ACTIVE' AND deactivated_at IS NULL)
        OR (status = 'DEACTIVATED' AND deactivated_at IS NOT NULL))
    );
    CREATE TABLE levex.accounts (
      id uuid PRIMARY KEY,
      actor_id uuid NOT NULL REFERENCES levex.actors(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      provider varchar(64) NOT NULL CHECK (provider ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
      provider_subject varchar(255) NOT NULL CHECK (char_length(provider_subject) BETWEEN 1 AND 255),
      status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DEACTIVATED')),
      version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
      created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
      updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
      deactivated_at timestamptz,
      UNIQUE(provider, provider_subject),
      CHECK ((status = 'ACTIVE' AND deactivated_at IS NULL)
        OR (status = 'DEACTIVATED' AND deactivated_at IS NOT NULL))
    );
    CREATE INDEX idx_accounts_actor_id ON levex.accounts(actor_id);
    CREATE FUNCTION levex_private.guard_account_binding() RETURNS trigger
      LANGUAGE plpgsql SECURITY INVOKER
      SET search_path = pg_catalog, levex_private, pg_temp AS $guard$
    BEGIN
      IF TG_TABLE_SCHEMA <> 'levex' OR TG_TABLE_NAME <> 'accounts'
         OR TG_OP <> 'UPDATE' OR TG_NARGS <> 0 THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'INVALID_GUARD_ATTACHMENT';
      END IF;
      IF ROW(NEW.id, NEW.actor_id, NEW.provider, NEW.provider_subject, NEW.created_at)
         IS DISTINCT FROM ROW(OLD.id, OLD.actor_id, OLD.provider, OLD.provider_subject, OLD.created_at) THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'IMMUTABLE_ACCOUNT_BINDING';
      END IF;
      RETURN NEW;
    END;
    $guard$;
    REVOKE ALL ON FUNCTION levex_private.guard_account_binding() FROM PUBLIC;
    CREATE TRIGGER accounts_guard_binding BEFORE UPDATE ON levex.accounts
      FOR EACH ROW EXECUTE FUNCTION levex_private.guard_account_binding();
    ALTER TABLE levex.actors ENABLE ROW LEVEL SECURITY;
    ALTER TABLE levex.actors FORCE ROW LEVEL SECURITY;
    ALTER TABLE levex.accounts ENABLE ROW LEVEL SECURITY;
    ALTER TABLE levex.accounts FORCE ROW LEVEL SECURITY;
    -- INTENTIONAL D-F01 PROOF ONLY: this must make ci / db-authz fail.
    ALTER TABLE levex.accounts NO FORCE ROW LEVEL SECURITY;
    RESET ROLE;
  `);
};
exports.down = () => {
  throw new Error(
    "FORWARD_ONLY_MIGRATION: use reviewed forward fix or tested backup restore"
  );
};
