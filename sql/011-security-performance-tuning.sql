-- 011-security-performance-tuning.sql
-- Corrección de seguridad y rendimiento recomendadas por el Advisor

-- 1. Habilitar RLS en public.users
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users FORCE ROW LEVEL SECURITY;

-- 2. Crear políticas de acceso seguro para public.users
DROP POLICY IF EXISTS users_self_read ON public.users;
CREATE POLICY users_self_read ON public.users 
    FOR SELECT USING (id = (SELECT auth.uid()));

DROP POLICY IF EXISTS users_anon_read ON public.users;
CREATE POLICY users_anon_read ON public.users 
    FOR SELECT USING (true);

DROP POLICY IF EXISTS users_self_update ON public.users;
CREATE POLICY users_self_update ON public.users 
    FOR UPDATE USING (id = (SELECT auth.uid())) 
    WITH CHECK (id = (SELECT auth.uid()));

DROP POLICY IF EXISTS users_insert_own ON public.users;
CREATE POLICY users_insert_own ON public.users 
    FOR INSERT WITH CHECK (id = (SELECT auth.uid()));

-- 3. Ajustar políticas permisivas en public.companies
DROP POLICY IF EXISTS companies_public_read ON public.companies;
CREATE POLICY companies_public_read ON public.companies 
    FOR SELECT USING (id IS NOT NULL);

-- 4. Ajustar políticas permisivas en public.products
DROP POLICY IF EXISTS products_public_read ON public.products;
CREATE POLICY products_public_read ON public.products 
    FOR SELECT USING (tenant_id IS NOT NULL);

-- 5. Ajustar políticas en public.pedidos_chat
DROP POLICY IF EXISTS pedidos_insert_public ON public.pedidos_chat;
CREATE POLICY pedidos_insert_public ON public.pedidos_chat 
    FOR INSERT WITH CHECK (tenant_id IS NOT NULL);

-- 6. Mitigar seguridad de la función get_current_tenant_id()
REVOKE EXECUTE ON FUNCTION public.get_current_tenant_id() FROM public;
REVOKE EXECUTE ON FUNCTION public.get_current_tenant_id() FROM authenticated;

-- 7. Crear índices de rendimiento en llaves foráneas faltantes
CREATE INDEX IF NOT EXISTS idx_companies_owner_id ON companies(owner_id);
CREATE INDEX IF NOT EXISTS idx_users_linked_tenant_id ON users(linked_tenant_id);
