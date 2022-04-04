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

  const newLiquidityGaugeInterface = new utils.Interface(['function scaling_factor() external view returns(uint256)']);

  const erc20Interface = new utils.Interface(['function balanceOf(address token) external view returns(uint256)']);

  const gUNIUSDC = '0x2bD9F7974Bc0E4Cb19B8813F8Be6034F3E772add';
  const gaugeUSDC = CONTRACTS_ADDRESSES[ChainId.MAINNET].ExternalStakings![0].liquidityGaugeAddress;
  const liquidityGaugeAddress: string = gaugeUSDC !== undefined ? gaugeUSDC : '0x';
  const contractLiquidityGauge = new ethers.Contract(liquidityGaugeAddress, LiquidityGaugeV4_Interface, governorSigner);
  const contractLiquidityGaugeUpgrade = new ethers.Contract(
    liquidityGaugeAddress,
    newLiquidityGaugeInterface,
    governorSigner,
  );
  const uniMigrator = await deployments.get('UniMigrator');
  const uniMigratorContract = new ethers.Contract(uniMigrator.address, uniMigratorInterface, deployer);

  console.log('Transferring ownership to the migrator contract');
  await (await contractLiquidityGauge.connect(governorSigner).commit_transfer_ownership(uniMigrator.address)).wait();
  console.log('Success');
  console.log('');

  console.log('Liquidity Migration');
  const tx = await (await uniMigratorContract.connect(deployer).migratePool(1, 0, 0)).wait();
  console.log('Success');
  console.log('Now performing checks on updates in the contract');

  console.log('Scaling factor');
  const scalingFactor = await contractLiquidityGaugeUpgrade.scaling_factor();
  console.log(scalingFactor.toString());
  console.log('Staking Token');
  const newStakingToken = await contractLiquidityGauge.staking_token();
  console.log(newStakingToken);

  // Verifying withdraw pre
  const depositor = '0x4F4715CA99C973A55303bc4a5f3e3acBb9fF75DB';
  await network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [depositor],
  });

  await network.provider.send('hardhat_setBalance', [depositor, '0x10000000000000000000000000000']);
  const depositorSigner = await ethers.provider.getSigner(depositor);
  const contractLiquidityGaugeOtherSigner = new ethers.Contract(
    liquidityGaugeAddress,
    LiquidityGaugeV4_Interface,
    depositorSigner,
  );
  const balance = await contractLiquidityGaugeOtherSigner.balanceOf(depositorSigner._address);
  console.log('Withdrawer Balance', balance.toString());
  await (await contractLiquidityGaugeOtherSigner.connect(depositorSigner)['withdraw(uint256)'](balance)).wait();
  console.log('Success on the withdrawal');

  expect(await contractLiquidityGaugeOtherSigner.balanceOf(depositorSigner._address)).to.be.equal(0);
  const newGuniContract = new ethers.Contract(newStakingToken, erc20Interface, governorSigner);
  expect(await newGuniContract.balanceOf(depositorSigner._address)).to.be.equal(
    balance.mul(parseAmount.ether('1')).div(scalingFactor),
  );
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
