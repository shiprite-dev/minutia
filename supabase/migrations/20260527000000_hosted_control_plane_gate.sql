INSERT INTO public.instance_config (key, value)
VALUES ('hosted_control_plane', 'false')
ON CONFLICT (key) DO NOTHING;
