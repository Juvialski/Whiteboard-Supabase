-- READ ONLY. Catalog metadata only; no user board/asset contents.
begin read only;
select jsonb_build_object(
 'migrations', (select jsonb_agg(to_jsonb(m)) from (select version, name from supabase_migrations.schema_migrations order by version) m),
 'tables', (select jsonb_agg(to_jsonb(t)) from (select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by relname) t),
 'definers', (select jsonb_agg(to_jsonb(f)) from (select p.oid::regprocedure::text as signature, p.proconfig, p.proacl,
   pg_get_functiondef(p.oid) as definition from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef order by signature) f),
 'missing_fk_indexes', (select jsonb_agg(to_jsonb(f)) from (
   select c.conrelid::regclass::text as table_name, c.conname, pg_get_constraintdef(c.oid) as definition
   from pg_constraint c where c.contype = 'f' and c.connamespace = 'public'::regnamespace
   and not exists (select 1 from pg_index i where i.indrelid = c.conrelid
     and i.indisvalid and i.indpred is null and (i.indkey::smallint[])[0:cardinality(c.conkey)-1] @> c.conkey)) f)
 ) as audit;
commit;
