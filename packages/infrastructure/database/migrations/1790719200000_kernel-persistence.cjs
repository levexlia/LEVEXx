exports.shorthands = undefined;

// Business outcomes stay in TypeScript. SQL guards structure, ownership,
// immutability and atomicity. This role is a server role, never a client role.
exports.up = (pgm) => {
  pgm.sql(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'levex_kernel_runtime') THEN
        CREATE ROLE levex_kernel_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
      END IF;
    END $$;
    CREATE SCHEMA levex_kernel;
    REVOKE ALL ON SCHEMA levex_kernel FROM PUBLIC;
    GRANT USAGE ON SCHEMA levex_kernel TO levex_kernel_runtime;

    CREATE TABLE levex_kernel.catalog (
      body jsonb NOT NULL CHECK (jsonb_typeof(body) = 'object'),
      version_id text GENERATED ALWAYS AS (body->>'versionId') STORED PRIMARY KEY,
      quest_id text GENERATED ALWAYS AS (body->>'id') STORED NOT NULL,
      UNIQUE (version_id, quest_id)
    );
    CREATE TABLE levex_kernel.subject_policy (
      participant_id text PRIMARY KEY,
      consent_status text NOT NULL CHECK (consent_status IN ('ACTIVE', 'REVOKED')),
      consent_until timestamptz NOT NULL,
      lock_token boolean NOT NULL DEFAULT false CHECK (lock_token = false)
    );
    CREATE TABLE levex_kernel.session_policy (
      session_id text PRIMARY KEY,
      actor_id text NOT NULL,
      actor_role text NOT NULL CHECK (actor_role IN ('participant', 'mentor')),
      active boolean NOT NULL,
      expires_at timestamptz NOT NULL,
      lock_token boolean NOT NULL DEFAULT false CHECK (lock_token = false)
    );
    CREATE TABLE levex_kernel.attempts (
      id text PRIMARY KEY,
      participant_id text NOT NULL REFERENCES levex_kernel.subject_policy(participant_id),
      mentor_id text NOT NULL CHECK (mentor_id <> participant_id),
      quest_id text NOT NULL,
      quest_version_id text NOT NULL,
      assignment_active boolean NOT NULL DEFAULT true,
      version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
      phase text NOT NULL DEFAULT 'AVAILABLE' CHECK (phase IN ('AVAILABLE','ACCEPTED','SUBMITTED','ASSESSED','MASTERED')),
      changed_at text,
      mastery_status text NOT NULL DEFAULT 'UNASSESSED' CHECK (mastery_status IN ('UNASSESSED','NOT_MASTERED','PARTIAL','MASTERED')),
      FOREIGN KEY (quest_version_id, quest_id) REFERENCES levex_kernel.catalog(version_id, quest_id),
      UNIQUE (id, participant_id),
      UNIQUE (participant_id, quest_version_id)
    );
    CREATE FUNCTION levex_kernel.deny_history_change() RETURNS trigger
      LANGUAGE plpgsql SET search_path = pg_catalog AS $$
    BEGIN RAISE EXCEPTION 'immutable kernel history' USING ERRCODE = '23514'; END $$;
    CREATE FUNCTION levex_kernel.guard_evaluation_change() RETURNS trigger
      LANGUAGE plpgsql SET search_path = pg_catalog AS $$
    BEGIN
      IF TG_OP = 'UPDATE' AND OLD.body->>'status' = 'DRAFT'
        AND NEW.body->>'status' = 'FINALIZED'
        AND OLD.body->'finalizedAt' = 'null'::jsonb
        AND jsonb_typeof(NEW.body->'finalizedAt') = 'string'
        AND (OLD.body - 'status' - 'finalizedAt') = (NEW.body - 'status' - 'finalizedAt') THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'immutable evaluation revision' USING ERRCODE = '23514';
    END $$;
    CREATE FUNCTION levex_kernel.guard_attempt_change() RETURNS trigger
      LANGUAGE plpgsql SET search_path = pg_catalog AS $$
    BEGIN
      IF (NEW.id, NEW.participant_id, NEW.mentor_id, NEW.quest_id, NEW.quest_version_id)
        IS DISTINCT FROM (OLD.id, OLD.participant_id, OLD.mentor_id, OLD.quest_id, OLD.quest_version_id) THEN
        RAISE EXCEPTION 'immutable attempt identity' USING ERRCODE = '23514';
      END IF;
      IF NEW.assignment_active IS DISTINCT FROM OLD.assignment_active THEN
        IF (NEW.version, NEW.phase, NEW.changed_at, NEW.mastery_status)
          IS DISTINCT FROM (OLD.version, OLD.phase, OLD.changed_at, OLD.mastery_status) THEN
          RAISE EXCEPTION 'policy and projection writes must be separate' USING ERRCODE = '23514';
        END IF;
      ELSIF NEW.version <> OLD.version + 1 THEN
        RAISE EXCEPTION 'invalid attempt version increment' USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END $$;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA levex_kernel FROM PUBLIC;
    CREATE TRIGGER attempt_update BEFORE UPDATE ON levex_kernel.attempts
      FOR EACH ROW EXECUTE FUNCTION levex_kernel.guard_attempt_change();
    CREATE TRIGGER attempt_delete BEFORE DELETE ON levex_kernel.attempts
      FOR EACH ROW EXECUTE FUNCTION levex_kernel.deny_history_change();
  `);

  const recordTable = (name, fields) =>
    pgm.sql(`
    CREATE TABLE levex_kernel.${name} (
      body jsonb NOT NULL CHECK (jsonb_typeof(body) = 'object'),
      id text GENERATED ALWAYS AS (body->>'id') STORED PRIMARY KEY,
      attempt_id text GENERATED ALWAYS AS (body->>'questInstanceId') STORED NOT NULL,
      participant_id text GENERATED ALWAYS AS (body->>'participantId') STORED NOT NULL,
      FOREIGN KEY (attempt_id, participant_id) REFERENCES levex_kernel.attempts(id, participant_id),
      UNIQUE (id, attempt_id, participant_id),
      ${fields}
    );
  `);
  recordTable(
    "artifacts",
    `
    position integer GENERATED ALWAYS AS ((body->>'version')::integer) STORED NOT NULL CHECK (position > 0),
    content_hash text GENERATED ALWAYS AS (body->>'contentHash') STORED NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
    object_version text GENERATED ALWAYS AS (body->>'objectVersion') STORED NOT NULL,
    UNIQUE (attempt_id, position), UNIQUE (attempt_id, content_hash), UNIQUE (attempt_id, object_version)
  `
  );
  recordTable(
    "evaluations",
    `
    position integer GENERATED ALWAYS AS ((body->>'revision')::integer) STORED NOT NULL CHECK (position > 0),
    artifact_id text GENERATED ALWAYS AS (body->>'artifactVersionId') STORED NOT NULL,
    rubric_id text GENERATED ALWAYS AS (body->>'rubricVersionId') STORED NOT NULL,
    status text GENERATED ALWAYS AS (body->>'status') STORED NOT NULL CHECK (status IN ('DRAFT','FINALIZED')),
    supersedes_id text GENERATED ALWAYS AS (body->>'supersedesRevisionId') STORED,
    FOREIGN KEY (artifact_id, attempt_id, participant_id) REFERENCES levex_kernel.artifacts(id, attempt_id, participant_id),
    FOREIGN KEY (supersedes_id, attempt_id, participant_id) REFERENCES levex_kernel.evaluations(id, attempt_id, participant_id),
    UNIQUE (attempt_id, position),
    UNIQUE (id, attempt_id, participant_id, artifact_id, rubric_id, status)
  `
  );
  recordTable(
    "evidence",
    `
    artifact_id text GENERATED ALWAYS AS (body->>'artifactVersionId') STORED NOT NULL,
    evaluation_id text GENERATED ALWAYS AS (body->>'evaluationRevisionId') STORED NOT NULL,
    rubric_id text GENERATED ALWAYS AS (body->>'rubricVersionId') STORED NOT NULL,
    evaluation_status text NOT NULL DEFAULT 'FINALIZED' CHECK (evaluation_status = 'FINALIZED'),
    CHECK ((body->>'status') IS NOT DISTINCT FROM 'VERIFIED'),
    FOREIGN KEY (evaluation_id, attempt_id, participant_id, artifact_id, rubric_id, evaluation_status)
      REFERENCES levex_kernel.evaluations(id, attempt_id, participant_id, artifact_id, rubric_id, status),
    UNIQUE (evaluation_id),
    UNIQUE (id, attempt_id, participant_id, evaluation_id, artifact_id, rubric_id)
  `
  );
  recordTable(
    "mastery",
    `
    evidence_id text GENERATED ALWAYS AS (body->>'evidenceId') STORED NOT NULL,
    evaluation_id text GENERATED ALWAYS AS (body->>'evaluationRevisionId') STORED NOT NULL,
    artifact_id text GENERATED ALWAYS AS (body->>'artifactVersionId') STORED NOT NULL,
    rubric_id text GENERATED ALWAYS AS (body->>'rubricVersionId') STORED NOT NULL,
    status text GENERATED ALWAYS AS (body->>'status') STORED NOT NULL CHECK (status IN ('NOT_MASTERED','PARTIAL','MASTERED')),
    FOREIGN KEY (evidence_id, attempt_id, participant_id, evaluation_id, artifact_id, rubric_id)
      REFERENCES levex_kernel.evidence(id, attempt_id, participant_id, evaluation_id, artifact_id, rubric_id),
    UNIQUE (evidence_id), UNIQUE (id, attempt_id, participant_id, evidence_id, status)
  `
  );
  recordTable(
    "progression",
    `
    mastery_id text GENERATED ALWAYS AS (body->>'masteryRecordId') STORED NOT NULL,
    evidence_id text GENERATED ALWAYS AS (body->>'evidenceId') STORED NOT NULL,
    unlocked_quest_id text GENERATED ALWAYS AS (body->>'unlockedQuestId') STORED NOT NULL,
    required_status text NOT NULL DEFAULT 'MASTERED' CHECK (required_status = 'MASTERED'),
    FOREIGN KEY (mastery_id, attempt_id, participant_id, evidence_id, required_status)
      REFERENCES levex_kernel.mastery(id, attempt_id, participant_id, evidence_id, status),
    UNIQUE (participant_id, unlocked_quest_id)
  `
  );
  pgm.sql(`
    CREATE TABLE levex_kernel.receipts (
      body jsonb NOT NULL CHECK (jsonb_typeof(body) = 'object' AND (body->>'schemaVersion') IS NOT DISTINCT FROM '1'),
      attempt_id text GENERATED ALWAYS AS (body#>>'{result,snapshot,instance,id}') STORED NOT NULL,
      participant_id text GENERATED ALWAYS AS (body#>>'{result,snapshot,instance,participantId}') STORED NOT NULL,
      actor_id text GENERATED ALWAYS AS (body#>>'{principal,actorId}') STORED NOT NULL,
      actor_role text GENERATED ALWAYS AS (body#>>'{principal,role}') STORED NOT NULL CHECK (actor_role IN ('participant','mentor')),
      idempotency_key text GENERATED ALWAYS AS (body->>'idempotencyKey') STORED NOT NULL,
      version integer GENERATED ALWAYS AS ((body#>>'{result,snapshot,version}')::integer) STORED NOT NULL CHECK (version > 0),
      PRIMARY KEY (attempt_id, actor_id, actor_role, idempotency_key),
      UNIQUE (attempt_id, version),
      UNIQUE (attempt_id, version, actor_id, actor_role, idempotency_key),
      FOREIGN KEY (attempt_id, participant_id) REFERENCES levex_kernel.attempts(id, participant_id)
    );
    CREATE TABLE levex_kernel.audit (
      attempt_id text NOT NULL,
      participant_id text NOT NULL,
      version integer NOT NULL,
      actor_id text NOT NULL,
      actor_role text NOT NULL,
      idempotency_key text NOT NULL,
      command_type text NOT NULL,
      occurred_at timestamptz NOT NULL,
      PRIMARY KEY (attempt_id, version),
      FOREIGN KEY (attempt_id, version, actor_id, actor_role, idempotency_key)
        REFERENCES levex_kernel.receipts(attempt_id, version, actor_id, actor_role, idempotency_key),
      FOREIGN KEY (attempt_id, participant_id) REFERENCES levex_kernel.attempts(id, participant_id)
    );
    CREATE TABLE levex_kernel.outbox (
      body jsonb NOT NULL CHECK (jsonb_typeof(body) = 'object'),
      id text GENERATED ALWAYS AS (body->>'id') STORED PRIMARY KEY,
      attempt_id text GENERATED ALWAYS AS (body->>'aggregateId') STORED NOT NULL,
      participant_id text GENERATED ALWAYS AS (body->>'participantId') STORED NOT NULL,
      version integer GENERATED ALWAYS AS ((body->>'aggregateVersion')::integer) STORED NOT NULL,
      FOREIGN KEY (attempt_id, version) REFERENCES levex_kernel.receipts(attempt_id, version),
      FOREIGN KEY (attempt_id, participant_id) REFERENCES levex_kernel.attempts(id, participant_id)
    );
    CREATE TRIGGER evaluation_update BEFORE UPDATE OR DELETE ON levex_kernel.evaluations
      FOR EACH ROW EXECUTE FUNCTION levex_kernel.guard_evaluation_change();
    GRANT SELECT ON ALL TABLES IN SCHEMA levex_kernel TO levex_kernel_runtime;
    GRANT UPDATE (version, phase, changed_at, mastery_status) ON levex_kernel.attempts TO levex_kernel_runtime;
    GRANT UPDATE (body) ON levex_kernel.evaluations TO levex_kernel_runtime;
    -- Row-lock privilege only. The check constraint prevents changing this token.
    GRANT UPDATE (lock_token) ON levex_kernel.subject_policy, levex_kernel.session_policy TO levex_kernel_runtime;
    GRANT INSERT ON levex_kernel.artifacts, levex_kernel.evaluations, levex_kernel.evidence,
      levex_kernel.mastery, levex_kernel.progression, levex_kernel.receipts,
      levex_kernel.audit, levex_kernel.outbox TO levex_kernel_runtime;
  `);

  const actor = "current_setting('levex.actor_id', true)";
  const role = "current_setting('levex.actor_role', true)";
  const scope = `((${role} = 'participant' AND participant_id = ${actor}) OR (${role} = 'mentor' AND mentor_id = ${actor}))`;
  const policies = {
    attempts: scope,
    session_policy: `session_id = current_setting('levex.session_id', true) AND actor_id = ${actor} AND actor_role = ${role}`,
    subject_policy: `(${role} = 'participant' AND participant_id = ${actor}) OR EXISTS
      (SELECT 1 FROM levex_kernel.attempts a WHERE a.participant_id = subject_policy.participant_id)`,
  };
  for (const name of [
    "artifacts",
    "evaluations",
    "evidence",
    "mastery",
    "progression",
    "receipts",
    "audit",
    "outbox",
  ]) {
    policies[
      name
    ] = `EXISTS (SELECT 1 FROM levex_kernel.attempts a WHERE a.id = ${name}.attempt_id AND a.participant_id = ${name}.participant_id)`;
  }
  for (const [name, condition] of Object.entries(policies)) {
    pgm.sql(`
      ALTER TABLE levex_kernel.${name} ENABLE ROW LEVEL SECURITY;
      ALTER TABLE levex_kernel.${name} FORCE ROW LEVEL SECURITY;
      CREATE POLICY runtime_scope ON levex_kernel.${name} TO levex_kernel_runtime
        USING (${condition}) WITH CHECK (${condition});
    `);
  }
  for (const name of [
    "catalog",
    "artifacts",
    "evidence",
    "mastery",
    "progression",
    "receipts",
    "audit",
    "outbox",
  ]) {
    pgm.sql(`CREATE TRIGGER immutable_history BEFORE UPDATE OR DELETE ON levex_kernel.${name}
      FOR EACH ROW EXECUTE FUNCTION levex_kernel.deny_history_change();`);
  }
  for (const name of [
    "catalog",
    "attempts",
    "artifacts",
    "evaluations",
    "evidence",
    "mastery",
    "progression",
    "receipts",
    "audit",
    "outbox",
  ]) {
    pgm.sql(`CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON levex_kernel.${name}
      FOR EACH STATEMENT EXECUTE FUNCTION levex_kernel.deny_history_change();`);
  }
};

exports.down = (pgm) => {
  // Destructive rollback requires an empty/disposable environment or explicit data migration.
  pgm.sql("DROP SCHEMA levex_kernel CASCADE");
  // The cluster-wide NOLOGIN role is intentionally retained; credentials are never managed here.
};
