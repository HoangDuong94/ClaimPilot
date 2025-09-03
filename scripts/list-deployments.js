const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');

(async () => {
  try {
    const destinationName = process.env.DEST_NAME || 'aicore-destination';
    const apiVersion = process.env.API_VERSION || '2024-08-06';
    const url = `/v2/inference/deployments?api-version=${encodeURIComponent(apiVersion)}`;
    const resourceGroup = process.env.RESOURCE_GROUP || 'default';
    const resp = await executeHttpRequest({ destinationName }, { method: 'GET', url, headers: { 'AI-Resource-Group': resourceGroup } });
    const items = Array.isArray(resp.data?.value) ? resp.data.value : (Array.isArray(resp.data) ? resp.data : []);
    const out = items.map(d => ({ id: d.id || d.name || d.deploymentId, model: d.model || d.properties?.model, status: d.status || d.properties?.status })).slice(0, 50);
    console.log(JSON.stringify(out, null, 2));
  } catch (e) {
    console.error('Failed to list deployments:', e.message);
    process.exit(1);
  }
})();
