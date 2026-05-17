import { readFileSync } from 'fs';

// This is a placeholder for the AST-level security checks
// It currently uses regex as a fallback until a custom ESLint plugin is written
console.log('🔒 Running Policy-as-Code Security Gates...');

let failed = false;

// We will check all files in src/lib
// Since glob isn't guaranteed, we'll use a fast regex pass for now.
import { spawnSync } from 'child_process';

// Check for raw SQL strings passed directly to query methods instead of using the safe sql`` tagged template
// Looking for patterns like query("SELECT...") or query('INSERT...') or query(`UPDATE...`)
const grepResult = spawnSync('grep', ['-rn', '-E', "query\\\\([^`]*[\\\"'`]SELECT.*FROM|INSERT.*INTO|UPDATE.*SET|DELETE.*FROM", 'src/lib']);
if (grepResult.status === 0) {
    const output = grepResult.stdout.toString();
    if (output.trim().length > 0) {
        console.error('❌ FAIL: Raw UNPARAMETERIZED SQL detected in src/lib!');
        console.error('⚠️  Always use the safe sql`...` tagged template literal.');
        console.error(output);
        failed = true;
    }
}

// Check for default exports in src/lib (except specific allowed files)
const grepDefault = spawnSync('grep', ['-rn', 'export default', 'src/lib']);
if (grepDefault.status === 0) {
    const output = grepDefault.stdout.toString();
    console.error('❌ FAIL: Default exports are strictly forbidden in src/lib!');
    console.error(output);
    failed = true;
}

if (failed) {
    console.error('SECURITY GATE FAILED: Policy violations found.');
    process.exit(1);
}

console.log('✅ All security policies passed.');
process.exit(0);
