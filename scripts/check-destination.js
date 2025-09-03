/*
  Checks if a Destination named "aicore-destination" exists via Destination Configuration API
  Uses credentials from VCAP_SERVICES (provided by `cds bind --exec` in hybrid mode)
*/
const https = require('https');

function httpPostForm(url, form, basicAuth) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = new URLSearchParams(form).toString();
    const req = https.request({
      method: 'POST',
      hostname: u.hostname,
      path: u.pathname + (u.search || ''),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(data),
        ...(basicAuth ? { Authorization: `Basic ${basicAuth}` } : {})
      }
    }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(body)); } catch (e) { resolve(body); }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${body}`));
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function httpGetJson(url, bearer) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      method: 'GET',
      hostname: u.hostname,
      path: u.pathname + (u.search || ''),
      headers: {
        'Authorization': `Bearer ${bearer}`,
        'Accept': 'application/json'
      }
    }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(body)); } catch (e) { resolve(body); }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${body}`));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

(async () => {
  try {
    const vcap = JSON.parse(process.env.VCAP_SERVICES || '{}');
    const destCreds = vcap.destination && vcap.destination[0] && vcap.destination[0].credentials;
    if (!destCreds) {
      console.error('No destination credentials found in VCAP_SERVICES.');
      process.exit(2);
    }

    const tokenUrl = `${destCreds.url.replace(/\/$/, '')}/oauth/token`;
    const clientId = destCreds.clientid;
    const clientSecret = destCreds.clientsecret;
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const tokenResp = await httpPostForm(tokenUrl, { grant_type: 'client_credentials' }, basic);
    const accessToken = tokenResp.access_token;
    if (!accessToken) throw new Error('No access_token in token response');

    const listUrl = `${destCreds.uri.replace(/\/$/, '')}/destination-configuration/v1/subaccountDestinations`;
    const dests = await httpGetJson(listUrl, accessToken);
    const names = Array.isArray(dests) ? dests.map(d => d.Name) : [];
    const exists = names.includes('aicore-destination');
    console.log(JSON.stringify({ exists, names: names.slice(0, 10) }));
    process.exit(exists ? 0 : 1);
  } catch (e) {
    console.error('Destination check failed:', e.message);
    process.exit(3);
  }
})();

