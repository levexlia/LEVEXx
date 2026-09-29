exports.up = (pgm) => {
  pgm.sql(`
    SET LOCAL ROLE db_owner;
    CREATE SCHEMA levex AUTHORIZATION db_owner;
    CREATE SCHEMA levex_private AUTHORIZATION db_owner;
    REVOKE ALL ON SCHEMA levex, levex_private FROM PUBLIC;
    ALTER DEFAULT PRIVILEGES FOR ROLE db_owner IN SCHEMA levex
      REVOKE ALL ON TABLES FROM PUBLIC;
    ALTER DEFAULT PRIVILEGES FOR ROLE db_owner
      REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
    RESET ROLE;
  `);
};
exports.down = () => {
  throw new Error(
    "FORWARD_ONLY_MIGRATION: use reviewed forward fix or tested backup restore"
  );
};
