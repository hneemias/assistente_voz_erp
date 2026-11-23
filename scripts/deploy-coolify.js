const token = '5|jzU7YRlYFVoq767fARW2FTdXzo9eUQQpZ8ylJYtjf7348d5b';
const appUuid = '5gxyex3opkryw0c3tuwibghi';

async function deployAndMonitor() {
  console.log('Disparando deploy da aplicação no Coolify...');
  const res = await fetch(`http://coolify.hneemias.cloud:8000/api/v1/deploy?uuid=${appUuid}&force=false`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });

  const body = await res.json();
  console.log('Resposta do deploy:', JSON.stringify(body));

  const deploymentUuid = body.deployment_uuid || (body.deployments && body.deployments[0]?.deployment_uuid);
  if (!deploymentUuid) {
    console.log('Não foi retornado deployment_uuid específico.');
    return;
  }

  console.log(`Monitorando deployment ${deploymentUuid}...`);
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 6000));
    try {
      const depRes = await fetch(`http://coolify.hneemias.cloud:8000/api/v1/deployments/${deploymentUuid}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const depData = await depRes.json();
      console.log(`[${i * 6}s] Status: ${depData.status}`);
      if (depData.status === 'finished') {
        console.log('Deploy concluído com sucesso!');
        break;
      }
      if (depData.status === 'failed' || depData.status === 'cancelled') {
        console.error('Deploy falhou ou foi cancelado:', depData);
        break;
      }
    } catch (e) {
      console.log('Erro ao checar status:', e.message);
    }
  }
}

deployAndMonitor().catch(console.error);

