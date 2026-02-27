import './bot/index';
import { startCacheCron } from './tinyfish/ratesCache';
import { startYieldWatcher } from './monitor/yieldWatcher';

startCacheCron();
startYieldWatcher();

console.log('[DeFAI Bharat] All systems running 🇮🇳');
