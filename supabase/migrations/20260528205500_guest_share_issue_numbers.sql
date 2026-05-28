DO $$
DECLARE
  function_definition text;
BEGIN
  SELECT pg_get_functiondef('public.get_guest_share_payload(text)'::regprocedure)
  INTO function_definition;

  EXECUTE replace(
    function_definition,
    '''id'', i.id,',
    '''id'', i.id, ''issue_number'', i.issue_number,'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_guest_share_payload(text) TO anon, authenticated;
