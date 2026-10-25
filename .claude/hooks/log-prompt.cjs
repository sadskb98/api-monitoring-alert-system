const fs = require('fs'), path = require('path');
let input = '';
process.stdin.on('data', c => (input += c));
process.stdin.on('end', () => {
  try {
    const { prompt } = JSON.parse(input);
    const dir = path.join(process.env.CLAUDE_PROJECT_DIR || process.cwd(), 'ai-prompts');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'prompts_log.md'),
      `\n### ${new Date().toISOString()}\n\n${prompt}\n`);
  } catch (_) {}
  process.exit(0);
});
