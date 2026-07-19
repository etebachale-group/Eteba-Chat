-- =========================================================================
-- MIGRACIÓN: Soporte para Bulk Upsert en Productos (CSV Import Upsert)
-- =========================================================================

-- 1. Añadir columna updated_at a la tabla products si no existe
ALTER TABLE products ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- 2. Backfill para las filas existentes
UPDATE products SET updated_at = created_at WHERE updated_at IS NULL;

-- 3. Crear índice para una búsqueda rápida insensible a mayúsculas y espacios
CREATE INDEX IF NOT EXISTS idx_products_tenant_name ON products(tenant_id, lower(trim(name)));

-- 4. Crear función para aplicar inserciones y actualizaciones en una sola transacción (RPC)
CREATE OR REPLACE FUNCTION apply_bulk_upsert(
    p_tenant_id UUID,
    p_to_insert JSONB,
    p_to_update JSONB
) RETURNS VOID AS $$
DECLARE
    item JSONB;
BEGIN
    -- Insertar nuevos productos
    IF jsonb_array_length(p_to_insert) > 0 THEN
        INSERT INTO products (tenant_id, name, description, price, stock, image_url, created_at, updated_at)
        SELECT 
            p_tenant_id,
            (val->>'name'),
            (val->>'description'),
            (val->>'price')::NUMERIC,
            (val->>'stock')::INTEGER,
            (val->>'image_url'),
            now(),
            now()
        FROM jsonb_array_elements(p_to_insert) AS val;
    END IF;

    -- Actualizar productos existentes
    IF jsonb_array_length(p_to_update) > 0 THEN
        FOR item IN SELECT * FROM jsonb_array_elements(p_to_update) LOOP
            UPDATE products
            SET 
                name = (item->>'name'),
                description = (item->>'description'),
                price = (item->>'price')::NUMERIC,
                stock = (item->>'stock')::INTEGER,
                image_url = (item->>'image_url'),
                updated_at = now()
            WHERE id = (item->>'id')::UUID AND tenant_id = p_tenant_id;
        END LOOP;
    END IF;
END;
$$ LANGUAGE plpgsql;
