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
  const agEUR = '0x1a7e4e63778B4f12a199C062f3eFdD288afCBce8';
  const weth = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
  await network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [governor],
  });

  await network.provider.send('hardhat_setBalance', [governor, '0x10000000000000000000000000000']);
  const governorSigner = await ethers.provider.getSigner(governor);
  // For deposits and withdrawals
  const depositor = '0x3Ad4CeE90D0Eb10769AF8F3D8a58f9df39Af45Db';
  await network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [depositor],
  });

  await network.provider.send('hardhat_setBalance', [depositor, '0x10000000000000000000000000000']);
  const depositorSigner = await ethers.provider.getSigner(depositor);
  const [deployer] = await ethers.getSigners();

  const uniMigratorInterface = new utils.Interface([
    'function migratePool(uint8 gaugeType, uint256 amountAgEURMin, uint256 amountTokenMin) external returns (address poolCreated)',
    'function finishPoolMigration(uint256 amountAgEURMin, uint256 amountETHMin) external',
  ]);

  const newLiquidityGaugeInterface = new utils.Interface(['function scaling_factor() external view returns(uint256)']);

  const erc20Interface = new utils.Interface([
    'function balanceOf(address token) external view returns(uint256)',
    'function approve(address spender, uint256 amount)',
  ]);

  const gaugeETH = CONTRACTS_ADDRESSES[ChainId.MAINNET].ExternalStakings![1].liquidityGaugeAddress;
  const liquidityGaugeAddress: string = gaugeETH !== undefined ? gaugeETH : '0x';
  const contractLiquidityGauge = new ethers.Contract(liquidityGaugeAddress, LiquidityGaugeV4_Interface, governorSigner);
  const contractLiquidityGaugeUpgrade = new ethers.Contract(
    liquidityGaugeAddress,
    newLiquidityGaugeInterface,
    governorSigner,
  );
  const contractLiquidityGaugeOtherSigner = new ethers.Contract(
    liquidityGaugeAddress,
    LiquidityGaugeV4_Interface,
    depositorSigner,
  );
  const uniMigrator = await deployments.get('UniMigrator');
  const uniMigratorContract = new ethers.Contract(uniMigrator.address, uniMigratorInterface, deployer);
  const agEURContract = new ethers.Contract(agEUR, erc20Interface, deployer);
  const wethContract = new ethers.Contract(weth, erc20Interface, deployer);
  const guniContract = new ethers.Contract('0x26C2251801D2cfb5461751c984Dc3eAA358bdf0f', erc20Interface, deployer);

  console.log('Transferring ownership to the migrator contract');
  await (await contractLiquidityGauge.connect(governorSigner).commit_transfer_ownership(uniMigrator.address)).wait();
  console.log('Success');
  console.log('');

  console.log('In the first place seeking governor balances');
  const agEURBalance = await agEURContract.balanceOf(governor);
  const wethBalance = await wethContract.balanceOf(governor);
  console.log('');

  console.log('GUNI balance prior');
  console.log(formatAmount.ether(await guniContract.balanceOf(contractLiquidityGauge.address)));

  console.log('Liquidity Migration');
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
  console.log('Current block timestamp');
  console.log((await ethers.provider.getBlock(tx.blockNumber)).timestamp);
  console.log('');
  const newGuniContract = new ethers.Contract(newStakingToken, erc20Interface, deployer);

  console.log('Now testing a withdrawal in the meantime during the transition');
  const balancePre = await contractLiquidityGaugeOtherSigner.balanceOf(depositorSigner._address);
  console.log('Withdrawer Balance', formatAmount.ether(balancePre));
  await (await contractLiquidityGaugeOtherSigner.connect(depositorSigner)['withdraw(uint256)'](balancePre)).wait();
  console.log('Success on the withdrawal');
  expect(await contractLiquidityGaugeOtherSigner.balanceOf(depositorSigner._address)).to.be.equal(0);
  const expectedBalancePre = balancePre.mul(parseAmount.ether('1')).div(scalingFactor);
  expect(await newGuniContract.balanceOf(depositorSigner._address)).to.be.equal(expectedBalancePre);
  console.log('Supply correctly withdrawn');
  console.log('');
  console.log('Now testing deposit');
  await (
    await newGuniContract
      .connect(depositorSigner)
      .approve(contractLiquidityGaugeOtherSigner.address, expectedBalancePre)
  ).wait();
  const prevBalancePre = await newGuniContract.balanceOf(contractLiquidityGaugeOtherSigner.address);
  await (
    await contractLiquidityGaugeOtherSigner.connect(depositorSigner)['deposit(uint256)'](expectedBalancePre)
  ).wait();
  expect(await newGuniContract.balanceOf(depositorSigner._address)).to.be.equal(0);
  expect(await newGuniContract.balanceOf(contractLiquidityGaugeOtherSigner.address)).to.be.equal(
    prevBalancePre.add(expectedBalancePre),
  );
  // Balance is rounded down
  expect(await contractLiquidityGaugeOtherSigner.balanceOf(depositorSigner._address)).to.be.equal(balancePre.sub(1));
  console.log('Success on the Deposit');
  console.log('');

  console.log('Checking GUNI balance of old token: it should be 0 this time');
  expect(await guniContract.balanceOf(contractLiquidityGauge.address)).to.be.equal(0);

  console.log('New G-UNI token balance');
  console.log(formatAmount.ether(await newGuniContract.balanceOf(contractLiquidityGauge.address)));
  console.log('');

  console.log('Now checking leftover balances and if no liquidity lost');
  const agEURBalanceNew = await agEURContract.balanceOf(governor);
  const wethBalanceNew = await wethContract.balanceOf(governor);
  console.log('agEUR Balance evolution');
  console.log(
    formatAmount.ether(agEURBalanceNew.sub(agEURBalance)),
    formatAmount.ether(agEURBalanceNew),
    formatAmount.ether(agEURBalance),
  );
  console.log('wETH Balance evolution');
  console.log(
    formatAmount.ether(wethBalanceNew.sub(wethBalance)),
    formatAmount.ether(wethBalanceNew),
    formatAmount.ether(wethBalance),
  );
  const oldUniPool = '0x9496D107a4b90c7d18c703e8685167f90ac273B0';
  console.log('Old Uni pool balances');
  console.log(
    formatAmount.ether(await agEURContract.balanceOf(oldUniPool)),
    formatAmount.ether(await wethContract.balanceOf(oldUniPool)),
  );

  console.log('Now testing a withdrawal');

  // Verifying withdraw pre

  const balance = await contractLiquidityGaugeOtherSigner.balanceOf(depositorSigner._address);
  console.log('Withdrawer Balance', formatAmount.ether(balance));
  await (await contractLiquidityGaugeOtherSigner.connect(depositorSigner)['withdraw(uint256)'](balance)).wait();
  console.log('Success on the withdrawal');

  expect(await contractLiquidityGaugeOtherSigner.balanceOf(depositorSigner._address)).to.be.equal(0);
  const expectedBalance = balance.mul(parseAmount.ether('1')).div(scalingFactor);
  expect(await newGuniContract.balanceOf(depositorSigner._address)).to.be.equal(expectedBalance);
  console.log('Supply correctly withdrawn');
  console.log('');
  console.log('Now testing deposit');
  await (
    await newGuniContract.connect(depositorSigner).approve(contractLiquidityGaugeOtherSigner.address, expectedBalance)
  ).wait();
  const prevBalance = await newGuniContract.balanceOf(contractLiquidityGaugeOtherSigner.address);
  await (await contractLiquidityGaugeOtherSigner.connect(depositorSigner)['deposit(uint256)'](expectedBalance)).wait();
  expect(await newGuniContract.balanceOf(depositorSigner._address)).to.be.equal(0);
  expect(await newGuniContract.balanceOf(contractLiquidityGaugeOtherSigner.address)).to.be.equal(
    prevBalance.add(expectedBalance),
  );
  // Balance is rounded down
  expect(await contractLiquidityGaugeOtherSigner.balanceOf(depositorSigner._address)).to.be.equal(balance.sub(1));
  console.log('Success on the Deposit!');
  console.log('');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
