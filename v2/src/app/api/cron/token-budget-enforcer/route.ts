import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Suspend channels/tenants that have exceeded their budget
    // For now, just query them to log
    const overBudget = await sql`
      SELECT id, slug, token_budget, tokens_used
      FROM tenants
      WHERE tokens_used >= token_budget
    `;

    return NextResponse.json({ 
      success: true, 
      overBudgetTenants: overBudget,
      message: `Found ${overBudget.length} tenants over budget.`
    });
  } catch (error: any) {
    console.error('Token budget enforcer error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
