-- Disposable local database only: a product with an original price must survive.
DO $$ BEGIN
 IF current_database() NOT LIKE 'vettrack_phase2_clinic_%' THEN RAISE EXCEPTION 'Disposable clinic database required'; END IF;
END $$;
INSERT INTO public.producto(id_producto,id_veterinaria,nombre,descripcion,precio)
VALUES('73000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Legacy product preserved','Original description',123.45);
