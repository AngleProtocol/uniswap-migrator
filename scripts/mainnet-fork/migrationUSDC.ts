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
  const usdc = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
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

  const erc20Interface = new utils.Interface([
    'function balanceOf(address token) external view returns(uint256)',
    'function approve(address spender, uint256 amount)',
    'function totalSupply() external view returns(uint256)',
  ]);

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
  const agEURContract = new ethers.Contract(agEUR, erc20Interface, deployer);
  const usdcContract = new ethers.Contract(usdc, erc20Interface, deployer);

  console.log('Transferring ownership to the migrator contract');
  await (await contractLiquidityGauge.connect(governorSigner).commit_transfer_ownership(uniMigrator.address)).wait();
  console.log('Success');
  console.log('');

  console.log('In the first place seeking governor balances');
  const agEURBalance = await agEURContract.balanceOf(governor);
  const usdcBalance = await usdcContract.balanceOf(governor);

  console.log('Liquidity Migration');
  const tx = await (await uniMigratorContract.connect(deployer).migratePool(1, 0, 0)).wait();
  console.log('Success');
  console.log('');
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
  console.log('Now testing a withdrawal');

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
  console.log('Now checking leftover balances and if no liquidity lost');
  const agEURBalanceNew = await agEURContract.balanceOf(governor);
  const usdcBalanceNew = await usdcContract.balanceOf(governor);
  console.log('agEUR Balance evolution');
  console.log(
    formatAmount.ether(agEURBalanceNew.sub(agEURBalance)),
    formatAmount.ether(agEURBalanceNew),
    formatAmount.ether(agEURBalance),
  );
  console.log('USDC Balance evolution');
  console.log(
    formatAmount.usdc(usdcBalanceNew.sub(usdcBalance)),
    formatAmount.usdc(usdcBalanceNew),
    formatAmount.usdc(usdcBalance),
  );
  const oldUniPool = '0x7ED3F364668cd2b9449a8660974a26A092C64849';
  console.log('Old Uni pool balances');
  console.log(
    formatAmount.ether(await agEURContract.balanceOf(oldUniPool)),
    formatAmount.usdc(await usdcContract.balanceOf(oldUniPool)),
  );
  console.log('');

  // Other deposit and withdrawal tests
  console.log('Deposit/Withdrawal of less than the balance');
  const depositor2Address = '0x12d3d411d010891a88bff2401bd73fa41fb1316e';
  await network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [depositor2Address],
  });

  await network.provider.send('hardhat_setBalance', [depositor2Address, '0x10000000000000000000000000000']);
  const depositor2Signer = await ethers.provider.getSigner(depositor2Address);

  const balance2 = await contractLiquidityGaugeOtherSigner.balanceOf(depositor2Signer._address);
  const prevTotalSupply = await contractLiquidityGaugeOtherSigner.totalSupply();
  console.log('Withdrawer2 Balance', balance2.toString());
  await (
    await contractLiquidityGaugeOtherSigner.connect(depositor2Signer)['withdraw(uint256)'](balance2.div(3))
  ).wait();
  console.log('Success on the withdrawal of a portion of the balance');

  expect(await contractLiquidityGaugeOtherSigner.balanceOf(depositor2Signer._address)).to.be.equal(
    balance2.mul(2).div(3).add(1),
  );
  expect(await contractLiquidityGaugeOtherSigner.totalSupply()).to.be.equal(prevTotalSupply.sub(balance2.div(3)));
  const expectedBalance2 = balance2.div(3).mul(parseAmount.ether('1')).div(scalingFactor);
  expect(await newGuniContract.balanceOf(depositor2Signer._address)).to.be.equal(expectedBalance2);
  console.log(`New G-UNI token balance ${expectedBalance2} vs. withdrawn amount ${balance2.div(3)}`);
  console.log('');
  console.log('Now testing deposit');
  await (
    await newGuniContract
      .connect(depositor2Signer)
      .approve(contractLiquidityGaugeOtherSigner.address, parseAmount.ether('1000'))
  ).wait();
  const prevBalance2 = await newGuniContract.balanceOf(contractLiquidityGaugeOtherSigner.address);
  await (
    await contractLiquidityGaugeOtherSigner.connect(depositor2Signer)['deposit(uint256)'](expectedBalance2.div(4))
  ).wait();

  expect(await newGuniContract.balanceOf(depositor2Signer._address)).to.be.equal(expectedBalance2.mul(3).div(4));
  expect(await newGuniContract.balanceOf(contractLiquidityGaugeOtherSigner.address)).to.be.equal(
    prevBalance2.add(expectedBalance2.div(4)),
  );
  const estimatedAddedAmountInTheContract = expectedBalance2.div(4).mul(scalingFactor).div(parseAmount.ether('1'));
  console.log(
    `Deposited new G-UNI token amount ${expectedBalance2.div(
      4,
    )} vs. added balanceOf in the contract ${estimatedAddedAmountInTheContract} `,
  );
  // Balance is rounded down
  expect(await contractLiquidityGaugeOtherSigner.balanceOf(depositor2Signer._address)).to.be.equal(
    balance2.mul(2).div(3).add(estimatedAddedAmountInTheContract).add(1),
  );
  expect(await contractLiquidityGaugeOtherSigner.totalSupply()).to.be.equal(
    prevTotalSupply.sub(balance2.div(3)).add(estimatedAddedAmountInTheContract),
  );
  console.log('Success on the Deposit!');
  console.log('');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
