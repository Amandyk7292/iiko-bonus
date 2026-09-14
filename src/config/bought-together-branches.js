// Verified against active bakery addresses and iiko Department.Id on 2026-09-14.
// Do not infer mappings from a city alone: recommendations are branch-specific.
const aktau = {
  '62fa7ada-3d67-4f85-bb37-5b13f0e1345c': '8bae2e42-50e7-4124-be3c-f837fc165ba7', // 19a/11
  '48f71218-aa08-51bf-a6d9-2497c4a1e55b': '33e68e1d-a7bd-4ba7-992a-e3e8a960b1f3', // Dukat 17/1
  'a18ea0f1-ac22-5530-a56a-65d810181a12': 'eabcf287-9b7d-4bf6-b440-9609e0e35f3f', // 17/95
  'dc180678-d414-54bd-a077-959e72b7afe5': 'f15cca5c-19dc-4bfa-9ca8-f6a4a5415aaa', // 28 mkr
  '48a835eb-b78d-548e-a450-7789189d5785': '6bdbe50b-ece0-4fb1-b4e6-b2c6ce1e0ef8', // 19/33
  'cb2b13f5-6c4e-5592-adc7-8908bacddabd': '5bea974e-b194-482b-a605-0a0c47f23617', // 16/85
  '18ab2d90-7187-5b0b-a245-9c819a67a605': 'bc1334bf-2eb0-8b09-0167-6366b33b000d', // 5/20
  '7f073eb5-d112-5121-a132-68d8519b1188': 'eda111fa-f156-4632-8a7b-e3792c44e24e', // 18a/1
  'dcd47584-8559-574d-a223-467ce30069e6': '411e20ca-6711-4b4a-87ee-ebd1f650e86e', // 9 mkr
  'ea829279-4b48-5e9f-a763-e8ef06a53e57': 'b39a0feb-b129-4a68-887d-1cba8a0d9470', // 40/2
  '07788c1e-8ef0-5f24-ae46-0cbb9109e3eb': '7ec29091-495b-4245-b1f7-7766d02fb26f', // 17/6
  '92a71bf8-74b2-56a6-ae83-6d08f030ae6d': 'e66dded2-4e67-4656-8086-e742c28ce437', // 17/55
};

function branchBindings(env = process.env) {
  const defaults = Object.fromEntries(
    Object.entries(aktau).map(([branch, departmentId]) => [
      branch,
      { serverId: 'aktau-chain', departmentId },
    ]),
  );
  try {
    const configured = JSON.parse(env.BOUGHT_TOGETHER_BRANCHES_JSON || '{}');
    return configured && typeof configured === 'object' && !Array.isArray(configured)
      ? { ...defaults, ...configured }
      : defaults;
  } catch (_) {
    return defaults;
  }
}

module.exports = { branchBindings };
