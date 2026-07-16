-- Revoke anon execute on get_my_effective_permissions (previous REVOKE didn't stick)
REVOKE EXECUTE ON FUNCTION get_my_effective_permissions() FROM anon;
