exports.up = (pgm) => {
  pgm.sql(`
    SET LOCAL ROLE db_owner;
    CREATE TABLE levex.role_assignments (
      id uuid PRIMARY KEY,
      actor_id uuid NOT NULL REFERENCES levex.actors(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      role text NOT NULL CHECK (role IN ('participant', 'mentor', 'operator', 'guardian')),
      status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED')),
      assignment_source text NOT NULL DEFAULT 'OPERATOR' CHECK (assignment_source IN ('OPERATOR', 'BOOTSTRAP')),
      assigned_by_actor_id uuid REFERENCES levex.actors(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      assigned_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
      revoked_by_actor_id uuid REFERENCES levex.actors(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      revoked_at timestamptz,
      version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
      created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
      updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
      CHECK ((assignment_source = 'OPERATOR' AND assigned_by_actor_id IS NOT NULL)
        OR (assignment_source = 'BOOTSTRAP' AND assigned_by_actor_id IS NULL)),
      CHECK ((status = 'ACTIVE' AND revoked_at IS NULL AND revoked_by_actor_id IS NULL)
        OR (status = 'REVOKED' AND revoked_at IS NOT NULL AND revoked_by_actor_id IS NOT NULL))
    );
    CREATE UNIQUE INDEX uq_role_assignments_one_active_per_actor
      ON levex.role_assignments(actor_id) WHERE status = 'ACTIVE';
    CREATE INDEX idx_role_assignments_actor_status ON levex.role_assignments(actor_id, status);
    CREATE INDEX idx_role_assignments_role_status ON levex.role_assignments(role, status);
    CREATE FUNCTION levex_private.guard_role_assignment() RETURNS trigger
      LANGUAGE plpgsql SECURITY INVOKER
      SET search_path = pg_catalog, levex_private, pg_temp AS $guard$
    BEGIN
      IF TG_TABLE_SCHEMA <> 'levex' OR TG_TABLE_NAME <> 'role_assignments'
         OR TG_OP NOT IN ('INSERT', 'UPDATE') OR TG_NARGS <> 0 THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'INVALID_GUARD_ATTACHMENT';
      END IF;
      IF TG_OP = 'UPDATE' THEN
        IF ROW(NEW.id, NEW.actor_id, NEW.role, NEW.assignment_source, NEW.assigned_by_actor_id, NEW.assigned_at, NEW.created_at)
          IS DISTINCT FROM ROW(OLD.id, OLD.actor_id, OLD.role, OLD.assignment_source, OLD.assigned_by_actor_id, OLD.assigned_at, OLD.created_at) THEN
          RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'IMMUTABLE_ROLE_HISTORY';
        END IF;
        IF OLD.status = 'REVOKED' THEN
          RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'REVOKED_ROLE_HISTORY';
        END IF;
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ROLE_MUTATION_NOT_ENABLED';
      END IF;
      IF session_user <> 'migrator' OR current_user <> 'db_owner'
        OR NEW.assignment_source <> 'BOOTSTRAP' OR NEW.assigned_by_actor_id IS NOT NULL
        OR NEW.status <> 'ACTIVE' OR NEW.revoked_at IS NOT NULL OR NEW.revoked_by_actor_id IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ROLE_MUTATION_NOT_ENABLED';
      END IF;
      RETURN NEW;
    END;
    $guard$;
    REVOKE ALL ON FUNCTION levex_private.guard_role_assignment() FROM PUBLIC;
    CREATE TRIGGER role_assignments_guard BEFORE INSERT OR UPDATE ON levex.role_assignments
      FOR EACH ROW EXECUTE FUNCTION levex_private.guard_role_assignment();
    ALTER TABLE levex.role_assignments ENABLE ROW LEVEL SECURITY;
    ALTER TABLE levex.role_assignments FORCE ROW LEVEL SECURITY;
    RESET ROLE;
  `);
};
exports.down = () => {
  throw new Error(
    "FORWARD_ONLY_MIGRATION: use reviewed forward fix or tested backup restore"
  );
};
