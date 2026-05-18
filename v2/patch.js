const fs = require('fs');
const file = '/Users/mustafa/Desktop/Başkent WP ENTEGRE/v2/src/app/actions/integrations.ts';
let code = fs.readFileSync(file, 'utf8');

const newActions = `
export async function getMetaIntegrationConfig() {
  return withActionGuard(
    { actionName: 'getMetaIntegrationConfig' },
    async (ctx) => {
      const tenants = await ctx.db.executeSafe(sql\`
        SELECT meta_app_id, meta_app_secret, whatsapp_phone_id, whatsapp_business_id, 
               meta_page_token, meta_page_id, instagram_id
        FROM tenants WHERE id = \${ctx.tenantId}
      \`);
      
      if (tenants.length === 0) throw new Error("Tenant bulunamadı");
      
      const config = { ...tenants[0] };
      // Mask tokens for security
      if (config.meta_app_secret) config.meta_app_secret = '••••••••' + config.meta_app_secret.slice(-4);
      if (config.meta_page_token) config.meta_page_token = '••••••••' + config.meta_page_token.slice(-4);
      
      return { config };
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error };
    return { success: true, config: res.data?.config };
  });
}

export async function saveMetaIntegrationConfig(updates: any) {
  return withActionGuard(
    { 
      actionName: 'saveMetaIntegrationConfig',
      roles: ['owner', 'admin']
    },
    async (ctx) => {
      // Build dynamic update query, avoiding overwrite with masked data
      const fields: string[] = [];
      const values: any[] = [];
      let i = 1;
      
      const allowedKeys = ['meta_app_id', 'meta_app_secret', 'whatsapp_phone_id', 'whatsapp_business_id', 'meta_page_token', 'meta_page_id', 'instagram_id'];
      
      for (const key of allowedKeys) {
        if (updates[key] !== undefined && !updates[key]?.startsWith('••••••••')) {
          fields.push(\`\${key} = $\${i++}\`);
          values.push(updates[key]);
        }
      }
      
      if (fields.length === 0) return { success: true };
      
      values.push(ctx.tenantId);
      
      const rawSql = \`UPDATE tenants SET \${fields.join(', ')}, updated_at = NOW() WHERE id = $\${i}\`;
      
      // Since executeSafe with raw queries requires careful handling, we use the raw driver query here
      // But we are in a safe context and we know keys are safe column names
      await ctx.db._getDriver().query(rawSql, values);
      
      return { success: true };
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error };
    return { success: true };
  });
}
`;

code = code.replace('// ==========================================\n// ENTEGRASYON HEALTH-CHECK', newActions + '\n// ==========================================\n// ENTEGRASYON HEALTH-CHECK');
fs.writeFileSync(file, code);
console.log('Done');
