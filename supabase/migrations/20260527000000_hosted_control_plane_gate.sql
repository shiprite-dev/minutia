INSERT INTO public.instance_config (key, value)
VALUES ('***', 'false')
ON CONFLICT (key) DO NOTHING;
