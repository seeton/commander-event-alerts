import { ButtondownError } from './buttondown';
import { runMonthly } from './monthly';

const mode = process.argv[2] ?? 'preview';
if (!['preview','check','send'].includes(mode)) {
  console.error('Usage: npm run monthly -- preview|check|send');
  process.exitCode = 1;
} else {
  try {
    const result = await runMonthly({mode:mode as 'preview'|'check'|'send',enabled:process.env.DELIVERY_ENABLED,apiKey:process.env.BUTTONDOWN_API_KEY});
    console.log(JSON.stringify(result,null,2));
  } catch (error) {
    // Do not print raw provider responses, request headers, tokens, or stacks.
    console.error(JSON.stringify({status:'failed',code:error instanceof ButtondownError ? error.message : 'run_failed'}));
    process.exitCode = 1;
  }
}
