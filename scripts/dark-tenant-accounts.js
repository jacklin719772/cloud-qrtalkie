const fs = require('fs');
let content = fs.readFileSync('src/TenantAccountManagement.jsx', 'utf8');

const replacements = [
  ['background: #fff;', 'background: #1a2332;'],
  ['border: 1px solid #e2e8f0;', 'border: 1px solid #1f2937;'],
  ['box-shadow: 0 16px 40px rgba(15, 23, 42, 0.16);', 'box-shadow: 0 16px 40px rgba(0, 0, 0, 0.4);'],
  ['background: #f1f5f9;', 'background: #1f2937;'],
  ['background: rgba(255, 255, 255, 0.96);', 'background: #111827;'],
  ['border: 1px solid #e6eef8;', 'border: 1px solid #1f2937;'],
  ['box-shadow: 0 10px 26px rgba(15, 23, 42, 0.08);', 'box-shadow: none;'],
  ['border: 1px solid #d8e2ef;', 'border: 1px solid #374151;'],
  ['background: #f8fafc;', 'background: #1a2332;'],
  ['box-shadow: 0 12px 30px rgba(15, 23, 42, 0.08);', 'box-shadow: none;'],
  ['color: #0f172a;', 'color: #f3f4f6;'],
  ['color: #94a3b8;', 'color: #6b7280;'],
  ['color: #475569;', 'color: #9ca3af;'],
  ['color: #334155;', 'color: #d1d5db;'],
  ['color: #64748b;', 'color: #9ca3af;'],
  ['background: #fff;', 'background: #111827;'],
  ['color: #2563eb;', 'color: #60a5fa;'],
  ['background: #eff6ff;', 'background: #1e3a5f;'],
  ['color: #cbd5e1;', 'color: #4b5563;'],
];

let count = 0;
for (const [old, neo] of replacements) {
  const escaped = old.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(escaped, 'g');
  const matches = content.match(regex);
  if (matches) {
    content = content.replace(regex, neo);
    count += matches.length;
  }
}

fs.writeFileSync('src/TenantAccountManagement.jsx', content);
console.log('Replacements made: ' + count);
