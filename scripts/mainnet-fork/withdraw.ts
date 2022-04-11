/* simulation script to run on mainnet fork */
// This script unpauses new collateral after they have been deployed
import { network, ethers, deployments, contract } from 'hardhat';
import { CONTRACTS_ADDRESSES, ChainId } from '@angleprotocol/sdk';
import { expect } from './chai-setup';
import { parseAmount, formatAmount } from '../../utils/bignumber';
import {
  // eslint-disable-next-line camelcase
  LiquidityGaugeV4_Interface,
} from '@angleprotocol/sdk/dist/constants/interfaces';
import { utils } from 'ethers';

async function main() {
  // Verifying withdraw pre
  const depositor = '0x4F4715CA99C973A55303bc4a5f3e3acBb9fF75DB';
  await network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [depositor],
  });
  await network.provider.send('hardhat_setBalance', [depositor, '0x10000000000000000000000000000']);
  const depositorSigner = await ethers.provider.getSigner(depositor);
  const gaugeUSDC = CONTRACTS_ADDRESSES[ChainId.MAINNET].ExternalStakings![0].liquidityGaugeAddress;
  const liquidityGaugeAddress: string = gaugeUSDC !== undefined ? gaugeUSDC : '0x';
  const contractLiquidityGauge = new ethers.Contract(
    liquidityGaugeAddress,
    LiquidityGaugeV4_Interface,
    depositorSigner,
  );

  const balance = await contractLiquidityGauge.balanceOf(depositorSigner._address);
  console.log('Withdrawer Balance', balance.toString());
  await (await contractLiquidityGauge.connect(depositorSigner)['withdraw(uint256)'](balance)).wait();
  console.log('Success on the withdrawal');
  expect(await contractLiquidityGauge.balanceOf(depositorSigner._address)).to.be.equal(0);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
