-- LOCAL ONLY: match verified legacy tables before Phase 4; no production connection.
BEGIN;
DO $$ BEGIN
 IF current_database() NOT LIKE 'vettrack_phase2_clinic_%' THEN RAISE EXCEPTION 'Disposable clinic database required'; END IF;
END $$;
ALTER TABLE public.producto RENAME COLUMN id TO id_producto;
ALTER TABLE public.producto ADD COLUMN nombre varchar(100) NOT NULL DEFAULT 'Legacy product',ADD COLUMN descripcion text,
 ADD COLUMN precio numeric(10,2),ADD COLUMN id_veterinaria uuid REFERENCES public.veterinaria;
ALTER TABLE public.receta RENAME COLUMN id TO id_receta;
ALTER TABLE public.receta ADD COLUMN fecha timestamp DEFAULT now(),ADD COLUMN indicaciones text,
 ADD COLUMN id_diagnostico uuid REFERENCES public.diagnostico ON DELETE CASCADE,
 ADD COLUMN id_producto uuid REFERENCES public.producto ON DELETE SET NULL;
ALTER TABLE public.historialmedico RENAME COLUMN id TO id_historial;
ALTER TABLE public.historialmedico ADD COLUMN fecha_registro timestamp DEFAULT now(),ADD COLUMN observaciones text,
 ADD COLUMN id_mascota uuid REFERENCES public.mascota ON DELETE RESTRICT;
INSERT INTO public.diagnostico(id_diagnostico,descripcion,id_dueno,id_mascota,id_veterinaria)
 VALUES('71000000-0000-4000-8000-000000000001','Legacy diagnosis preserved','40000000-0000-4000-8000-000000000001',
 '50000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001');
INSERT INTO public.receta(id_receta,id_diagnostico,indicaciones) VALUES('72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','Legacy prescription preserved');
COMMIT;
