const token = '5|jzU7YRlYFVoq767fARW2FTdXzo9eUQQpZ8ylJYtjf7348d5b';
const appUuid = '5gxyex3opkryw0c3tuwibghi';
const toDelete = [
  'lhp8bi0ujic5mnfx02nynfzf',
  'lq0axwfeuyvkrhhftsldwlud',
  '0beth9i5cgtccoqnmub04a1x',
  'eyfiv7bnkllwqkh9c6pqezrz',
  '3ssrzegozmio5oflmp71iaal',
  'tmv72qqgbbxezytibttuble7',
  'dz6auivk3dvd7d0wkua3wwpl',
  'zklglr5llglxk3ffz8b4td4f',
  'gtbyttwk6yeibtbkouzxv0ey',
  '99pvl0sggmu86ykou4yiogsr',
  'i7temszhsnbl8yqwqivju9yv',
  'x5gt266vvr5robfepezbho8b',
  'gzzfqzs2iat7sldhpos80uu8',
  'y6xtitpdofyemguqjtrk6zlk',
  '2hraalu2kk6hzaic3qekcnt4',
  'cbcjktx1pmsxvxffxsbseerz',
  '55n0pvymsrw6xsg8icloxrpr',
  'hs8j6pikusmfc8ck0eorgpt8',
  'tyqcf4uemtto8byqnip9j5hd',
  'qdyijnsekjie0ry8odwlz7pj',
  'bwejowtk1mlle8ojr4cmtzxi',
  'hve2zrygzvlqmndegdqv0c5y',
  'uqmxfzcbbw6jcbwyyt33nsyh',
  '7gyd5w5x338qxc12wzjtyibn',
  'g3ju5axxwyluhajgk3g5ul2a'
];

async function run() {
  for (const uuid of toDelete) {
    try {
      const res = await fetch(`http://coolify.hneemias.cloud:8000/api/v1/applications/${appUuid}/envs/${uuid}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      console.log(`Deleted ${uuid}: status ${res.status}`);
    } catch (e) {
      console.error(`Error deleting ${uuid}:`, e.message);
    }
  }

  // Add TZ=America/Sao_Paulo
  try {
    const addRes = await fetch(`http://coolify.hneemias.cloud:8000/api/v1/applications/${appUuid}/envs`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        key: 'TZ',
        value: 'America/Sao_Paulo',
        is_preview: false
      })
    });
    console.log('Added TZ:', addRes.status);
  } catch (e) {
    console.error('Error adding TZ:', e.message);
  }

  // List remaining
  const listRes = await fetch(`http://coolify.hneemias.cloud:8000/api/v1/applications/${appUuid}/envs`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const envs = await listRes.json();
  console.log('Remaining envs count:', envs.length);
  envs.forEach(e => console.log(`- ${e.key} = ${e.value.slice(0, 35)}... (uuid: ${e.uuid})`));
}
run();
