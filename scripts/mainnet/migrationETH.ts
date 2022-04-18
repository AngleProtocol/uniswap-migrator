import { network, ethers, deployments, contract } from 'hardhat';
import { CONTRACTS_ADDRESSES, ChainId } from '@angleprotocol/sdk';
import { parseAmount, formatAmount } from '../../utils/bignumber';
import {
  // eslint-disable-next-line camelcase
  LiquidityGaugeV4_Interface,
} from '@angleprotocol/sdk/dist/constants/interfaces';
import { utils } from 'ethers';

async function main() {
  const [deployer] = await ethers.getSigners();

  const uniMigratorInterface = new utils.Interface([
    'function migratePool(uint8 gaugeType, uint256 amountAgEURMin, uint256 amountTokenMin) external returns (address poolCreated)',
  ]);

  const newLiquidityGaugeInterface = new utils.Interface(['function scaling_factor() external view returns(uint256)']);

  const erc20Interface = new utils.Interface([
    'function balanceOf(address token) external view returns(uint256)',
    'function approve(address spender, uint256 amount)',
  ]);

  const gaugeETH = CONTRACTS_ADDRESSES[ChainId.MAINNET].ExternalStakings![1].liquidityGaugeAddress;
  const liquidityGaugeAddress: string = gaugeETH !== undefined ? gaugeETH : '0x';
  const contractLiquidityGauge = new ethers.Contract(liquidityGaugeAddress, LiquidityGaugeV4_Interface, deployer);
  const contractLiquidityGaugeUpgrade = new ethers.Contract(
    liquidityGaugeAddress,
    newLiquidityGaugeInterface,
    deployer,
  );

  const uniMigrator = await deployments.get('UniMigrator');
  const uniMigratorContract = new ethers.Contract(uniMigrator.address, uniMigratorInterface, deployer);
  const guniContract = new ethers.Contract('0x26C2251801D2cfb5461751c984Dc3eAA358bdf0f', erc20Interface, deployer);

  console.log('GUNI balance prior');
  console.log(formatAmount.ether(await guniContract.balanceOf(contractLiquidityGauge.address)));

  console.log('Liquidity Migration');
  // TODO check the slippage protection here: how much you would have gotten from the previous pool
  // for this you can run the liquidityRemoval.ts file
  const tx = await (await uniMigratorContract.connect(deployer).migratePool(2, 0, 0)).wait();
  console.log('Success');
  console.log('');
  console.log('Checking leftover GUNI balance');
  console.log(formatAmount.ether(await guniContract.balanceOf(contractLiquidityGauge.address)));
  console.log('Now performing checks on updates in the contract');

  console.log('Scaling factor');
  const scalingFactor = await contractLiquidityGaugeUpgrade.scaling_factor();
  console.log(scalingFactor.toString());
  console.log('Staking Token');
  const newStakingToken = await contractLiquidityGauge.staking_token();
  console.log(newStakingToken);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
