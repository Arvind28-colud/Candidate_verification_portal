// Utility helper to interact with local Mantra MFS100 / Morpho / Startek RD Service ports
export const discoverRdServicePort = async () => {
  const ports = [11100, 11101, 11102, 11103, 11104, 11105, 8000, 8080];
  const hosts = ['127.0.0.1', 'localhost'];
  const protocols = ['http', 'https'];

  for (const port of ports) {
    for (const host of hosts) {
      for (const proto of protocols) {
        try {
          const baseUrl = `${proto}://${host}:${port}`;
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 2000);

          let res = await fetch(`${baseUrl}/rd/info`, {
            method: 'RDINFO',
            signal: controller.signal,
          }).catch(() =>
            fetch(`${baseUrl}/rd/info`, {
              method: 'GET',
              signal: controller.signal,
            })
          );

          clearTimeout(timeoutId);

          if (res && (res.ok || res.status === 200 || res.status === 405)) {
            let text = '';
            try { text = await res.text(); } catch (e) {}

            if (text && (text.includes('RDService') || text.includes('status=') || text.includes('Mantra') || text.includes('DeviceInfo'))) {
              const devMatch = text.match(/info="([^"]+)"/i) || text.match(/name="([^"]+)"/i);
              const statusMatch = text.match(/status="([^"]+)"/i);
              const status = statusMatch ? statusMatch[1].toUpperCase() : 'NOTREADY';
              const devName = devMatch ? devMatch[1] : `Mantra MFS100 Scanner (Port ${port})`;

              // ONLY return connected: true if the USB device is plugged in and status is READY
              if (status === 'READY') {
                return {
                  connected: true,
                  port,
                  baseUrl,
                  devName: `${devName} [READY]`,
                  status: 'READY',
                  rawXml: text,
                };
              }
            }
          }
        } catch (err) {
          // Probe next protocol / host / port
        }
      }
    }
  }

  // Return connected: false if no RD Service device is plugged in and ready
  return {
    connected: false,
    port: null,
    baseUrl: '',
    devName: '',
    status: 'NOT_CONNECTED',
    rawXml: ''
  };
};

export const detectRdServiceDevice = discoverRdServicePort;

export const captureFingerprintPid = async (baseUrl = 'http://127.0.0.1:11100', maxRetries = 3) => {
  const portToUse = typeof baseUrl === 'number' ? baseUrl : 11100;
  const targetUrls = typeof baseUrl === 'string' && baseUrl.startsWith('http')
    ? [
        baseUrl.endsWith('/rd/capture') ? baseUrl : `${baseUrl}/rd/capture`,
        `http://127.0.0.1:${portToUse}/rd/capture`,
        `http://localhost:${portToUse}/rd/capture`,
        `https://127.0.0.1:${portToUse}/rd/capture`
      ]
    : [
        `http://127.0.0.1:${portToUse}/rd/capture`,
        `http://localhost:${portToUse}/rd/capture`,
        `https://127.0.0.1:${portToUse}/rd/capture`
      ];

  const pidOptionsXml = `<?xml version="1.0"?>
<PidOptions ver="1.0">
  <Opts fCount="1" fType="2" iCount="0" pCount="0" format="0" pidMode="0" timeout="20000" otp="" env="P"/>
</PidOptions>`;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    let lastError = null;

    for (const url of targetUrls) {
      try {
        let res;
        try {
          res = await fetch(url, {
            method: 'CAPTURE',
            headers: { 'Content-Type': 'text/xml' },
            body: pidOptionsXml,
          });
        } catch (e) {
          res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'text/xml' },
            body: pidOptionsXml,
          });
        }

        if (!res.ok) {
          continue;
        }

        const xmlText = await res.text();

        // Extract errCode and errInfo strictly from Mantra MFS100 RD XML
        const errCodeMatch = xmlText.match(/errCode="([^"]+)"/i);
        const errInfoMatch = xmlText.match(/errInfo="([^"]+)"/i);

        const errCode = errCodeMatch ? errCodeMatch[1] : null;
        const errInfo = errInfoMatch ? errInfoMatch[1] : 'Fingerprint capture failed or was cancelled.';

        // SUCCESSFUL SCAN (errCode="0")
        if (errCode === '0' && (xmlText.includes('<Data') || xmlText.includes('type="HMAC"') || xmlText.includes('type="Biometric"'))) {
          return { success: true, pidXml: xmlText };
        }

        // MANTRA INITIALIZATION / DISCONNECTED ERROR -1509 ("System is still checking status...")
        if (errCode === '-1509' || errCode === '1509' || (errInfo && errInfo.includes('still checking status'))) {
          if (attempt < maxRetries) {
            console.log(`Mantra MFS100 USB status checking (Attempt ${attempt}/${maxRetries}). Retrying...`);
            await new Promise((resolve) => setTimeout(resolve, 1500));
            break; // Break inner URL loop and retry outer attempt loop
          } else {
            throw new Error('Mantra MFS100 USB scanner is not connected or status is NOTREADY. Please plug the Mantra USB scanner firmly into your USB port and click Scan Device.');
          }
        }

        // ALL OTHER SCAN ERRORS
        throw new Error(`Biometric Fingerprint Capture Failed (Error ${errCode || 'Code'}): ${errInfo}`);
      } catch (err) {
        lastError = err;
        if (err.message && (err.message.includes('Biometric Fingerprint Capture Failed') || err.message.includes('USB scanner is not connected'))) {
          throw err;
        }
      }
    }

    if (attempt === maxRetries && lastError) {
      throw lastError;
    }
  }

  throw new Error('Failed to communicate with Mantra MFS100 RD Service. Please connect your Mantra USB scanner and ensure Mantra RD Service software is running.');
};
