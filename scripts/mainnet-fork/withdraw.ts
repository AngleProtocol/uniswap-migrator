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

  const newLiquidityGaugeInterface = new utils.Interface(['function scaling_factor() external view returns(uint256)']);
  const contractLiquidityGaugeUpgrade = new ethers.Contract(
    liquidityGaugeAddress,
    newLiquidityGaugeInterface,
    depositorSigner,
  );
  // Tests in this contract are performed with a 0 scaling factor here
  expect(await contractLiquidityGaugeUpgrade.scaling_factor()).to.be.equal(0);

  const balance = await contractLiquidityGauge.balanceOf(depositorSigner._address);
  console.log('Withdrawer Balance', balance.toString());
  await (await contractLiquidityGauge.connect(depositorSigner)['withdraw(uint256)'](balance)).wait();
  console.log('Success on the withdrawal');
  expect(await contractLiquidityGauge.balanceOf(depositorSigner._address)).to.be.equal(0);

  console.log('Now testing a deposit of a portion of this balance');
  const gUNIUSDC = '0x2bD9F7974Bc0E4Cb19B8813F8Be6034F3E772add';
  const erc20Interface = new utils.Interface([
    'function balanceOf(address token) external view returns(uint256)',
    'function approve(address spender, uint256 amount) external',
  ]);
  const guniContract = new ethers.Contract(gUNIUSDC, erc20Interface, depositorSigner);
  const balanceGUNI = await guniContract.balanceOf(depositorSigner._address);
  // Allowance is already not null
  const totalSupply = await contractLiquidityGauge.totalSupply();
  await (await contractLiquidityGauge.connect(depositorSigner)['deposit(uint256)'](balanceGUNI.div(3))).wait();
  expect(await contractLiquidityGauge.balanceOf(depositorSigner._address)).to.be.equal(balanceGUNI.div(3));
  expect(await guniContract.balanceOf(depositorSigner._address)).to.be.equal(balanceGUNI.mul(2).div(3));
  console.log('Success when depositing to yourself');
  const toAddress = '0xEEa5B82B61424dF8020f5feDD81767f2d0D25Bfb';
  await (
    await contractLiquidityGauge.connect(depositorSigner)['deposit(uint256,address)'](balanceGUNI.div(3), toAddress)
  ).wait();
  expect(await guniContract.balanceOf(depositorSigner._address)).to.be.equal(balanceGUNI.div(3));
  expect(await contractLiquidityGauge.balanceOf(toAddress)).to.be.equal(balanceGUNI.div(3));
  console.log('Success when depositing to another address');
  console.log('Checking the total supply');
  expect(await contractLiquidityGauge.totalSupply()).to.be.equal(totalSupply.add(balanceGUNI.mul(2).div(3)));
  console.log('Success');
  console.log('Testing a withdraw from the address which received the funds in the first place');
  await network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [toAddress],
  });
  await network.provider.send('hardhat_setBalance', [toAddress, '0x10000000000000000000000000000']);
  const toSigner = await ethers.provider.getSigner(toAddress);
  await (await contractLiquidityGauge.connect(toSigner)['withdraw(uint256)'](balanceGUNI.div(6))).wait();
  expect(await guniContract.balanceOf(toAddress)).to.be.equal(balanceGUNI.div(6));
  expect(await contractLiquidityGauge.balanceOf(toAddress)).to.be.equal(balanceGUNI.div(6).add(1));
  console.log('Success');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
