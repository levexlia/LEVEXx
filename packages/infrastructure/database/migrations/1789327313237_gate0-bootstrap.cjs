/* 000001_gate0_bootstrap.cjs
   node-pg-migrate style migration (CJS)
   Creates levex_meta table on up, drops on down.
*/

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable("levex_meta", {
    id: { type: "bigserial", primaryKey: true },
    key: { type: "text", notNull: true, unique: true },
    value: { type: "jsonb" },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });
};

exports.down = (pgm) => {
  pgm.dropTable("levex_meta");
};
