require('dotenv').config();

const required = [
  'JWT_SECRET',
  'COOKIE_SECRET',
  'MYSQL_USER',
  'MYSQL_PASSWORD',
  'MYSQL_DATABASE',
  'SMTP_USER',
  'SMTP_PASS'
];

const optional = [
  'BASE_URL',
  'ALLOWED_ORIGINS',
  'SMTP_FROM_EMAIL',
  'SMTP_FROM_NAME'
];

const missing = [];
const present = [];

console.log('\n📋 Environment Variables Validation\n');
console.log('='.repeat(50));

// Check required variables
console.log('\n🔴 REQUIRED Variables:\n');
required.forEach(key => {
  const value = process.env[key];
  if (!value || value.trim() === '') {
    missing.push(key);
    console.log(`  ❌ ${key} - NOT SET`);
  } else {
    present.push(key);
    const masked = value.length > 10 ? value.substring(0, 10) + '...' : '***';
    console.log(`  ✅ ${key} - ${masked}`);
  }
});

// Check optional variables
console.log('\n🟡 OPTIONAL Variables:\n');
optional.forEach(key => {
  const value = process.env[key];
  if (!value || value.trim() === '') {
    console.log(`  ⚠️  ${key} - Not set (using default)`);
  } else {
    const masked = value.length > 20 ? value.substring(0, 20) + '...' : value;
    console.log(`  ✅ ${key} - ${masked}`);
  }
});

console.log('\n' + '='.repeat(50));
console.log(`\nResult: ${present.length}/${required.length} required variables set\n`);

if (missing.length > 0) {
  console.log('❌ FAILED: Please set the following variables in .env:\n');
  missing.forEach(k => console.log(`   - ${k}`));
  console.log('');
  process.exit(1);
} else {
  console.log('✅ SUCCESS: All required environment variables are configured!\n');
  console.log('You can now start the application with: npm run dev\n');
  process.exit(0);
}
