/* simulation script to run on mainnet fork */
// This script unpauses new collateral after they have been deployed
import { network, ethers, deployments } from 'hardhat';
import { CONTRACTS_ADDRESSES, ChainId } from '@angleprotocol/sdk';
import { expect } from './chai-setup';
import { parseAmount, formatAmount } from '../../utils/bignumber';
import {
  // eslint-disable-next-line camelcase
  LiquidityGaugeV4_Interface,
} from '@angleprotocol/sdk/dist/constants/interfaces';
import { utils } from 'ethers';

async function main() {
  // =============== Simulation parameters ====================

  // const params = CONSTANTS(1);

  const governor = '0xdC4e6DFe07EFCa50a197DF15D9200883eF4Eb1c8';
  await network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [governor],
  });

  await network.provider.send('hardhat_setBalance', [governor, '0x10000000000000000000000000000']);
  const governorSigner = await ethers.provider.getSigner(governor);
  const [deployer] = await ethers.getSigners();

  const uniMigratorInterface = new utils.Interface([
    'function migratePool(uint8 gaugeType, uint256 amountAgEURMin, uint256 amountTokenMin) external returns (address poolCreated)',
    'function finishPoolMigration(uint256 amountAgEURMin, uint256 amountETHMin) external',
  ]);

  const erc20Interface = new utils.Interface(['function balanceOf(address token) external view returns(uint256)']);

  const gUNIUSDC = '0x2bD9F7974Bc0E4Cb19B8813F8Be6034F3E772add';
  const gaugeUSDC = CONTRACTS_ADDRESSES[ChainId.MAINNET].ExternalStakings![0].liquidityGaugeAddress;
  const liquidityGaugeAddress: string = gaugeUSDC !== undefined ? gaugeUSDC : '0x';
  const contractLiquidityGauge = new ethers.Contract(liquidityGaugeAddress, LiquidityGaugeV4_Interface, governorSigner);
  const uniMigrator = await deployments.get('UniMigrator');
  const uniMigratorContract = new ethers.Contract(uniMigrator.address, uniMigratorInterface, deployer);

  console.log('Transferring ownership to the migrator contract');
  await (await contractLiquidityGauge.connect(governorSigner).commit_transfer_ownership(uniMigrator.address)).wait();
  console.log('Success');
  console.log('Liquidity Migration');
  await (await uniMigratorContract.connect(deployer).migratePool(1, 0, 0)).wait();
  console.log('Success');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
