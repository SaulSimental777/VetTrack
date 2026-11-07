-- Disposable PostgreSQL fixture only: verified real legacy payment shape.
DO $$ BEGIN IF current_database() NOT LIKE 'vettrack_phase2_clinic_%' THEN RAISE EXCEPTION 'Disposable database required';END IF;END $$;
ALTER TABLE public.pago RENAME COLUMN id TO id_pago;
ALTER TABLE public.pago ADD COLUMN monto numeric(10,2) NOT NULL DEFAULT 0,ADD COLUMN fecha_pago timestamp DEFAULT now(),
 ADD COLUMN id_cita uuid REFERENCES public.cita,ADD COLUMN id_metodopago uuid REFERENCES public.metododepago,ADD COLUMN id_dueno uuid REFERENCES public.dueno;
