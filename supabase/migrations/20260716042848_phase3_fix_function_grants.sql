-- Revoke all public access and re-grant only to authenticated
REVOKE ALL ON FUNCTION get_my_effective_permissions() FROM PUBLIC;
REVOKE ALL ON FUNCTION get_my_effective_permissions() FROM anon;
GRANT EXECUTE ON FUNCTION get_my_effective_permissions() TO authenticated;
