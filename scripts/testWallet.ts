import { getSmartAccountAddress } from '../src/wallet/pimlico';

async function main() {
  try {
    console.log('='.repeat(60));
    console.log('DeFAI Bharat - Smart Account Setup');
    console.log('='.repeat(60));
    console.log('');

    console.log('Initializing smart account...');
    const address = await getSmartAccountAddress();

    console.log('');
    console.log('✓ Smart Account Address:', address);
    console.log('');
    console.log('='.repeat(60));
    console.log('NEXT STEPS:');
    console.log('='.repeat(60));
    console.log('');
    console.log('1. Fund this address with testnet BNB:');
    console.log(`   Address: ${address}`);
    console.log('');
    console.log('2. Get testnet BNB from BSC faucet:');
    console.log('   https://testnet.bnbchain.org/faucet-smart');
    console.log('');
    console.log('3. Verify balance on BSC Testnet explorer:');
    console.log(`   https://testnet.bscscan.com/address/${address}`);
    console.log('');
    console.log('='.repeat(60));
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
