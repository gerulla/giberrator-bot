import 'dotenv/config';
import { translateGibberish } from '../src/services/gibberishTranslator.js';

const input = process.argv.slice(2).join(' ');

if (!input) {
  console.error('Usage: npm run translate -- "i cnat evn typw thsi rn"');
  process.exit(1);
}

const translations = await translateGibberish(input);
console.log(JSON.stringify(translations));
