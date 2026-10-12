const crypto = require('node:crypto');
const https = require('node:https');
const tls = require('node:tls');

// OOFD currently sends only its leaf certificate. Supply its missing issuing
// intermediate, published by the CA vendor (not a new trust root).
// Source: https://www.gogetssl.com/wiki/intermediate-certificates/gogetssl-intermediate-root-certificates/
// PEM: https://gogetssl-cdn.s3.eu-central-1.amazonaws.com/wiki/gogetssl-rsa-dv-ca.txt
const OOFD_INTERMEDIATE_PEM = `-----BEGIN CERTIFICATE-----
MIIF1zCCA7+gAwIBAgIRAJOLsI5imHtPdfmMtqUEXJYwDQYJKoZIhvcNAQEMBQAw
gYgxCzAJBgNVBAYTAlVTMRMwEQYDVQQIEwpOZXcgSmVyc2V5MRQwEgYDVQQHEwtK
ZXJzZXkgQ2l0eTEeMBwGA1UEChMVVGhlIFVTRVJUUlVTVCBOZXR3b3JrMS4wLAYD
VQQDEyVVU0VSVHJ1c3QgUlNBIENlcnRpZmljYXRpb24gQXV0aG9yaXR5MB4XDTE4
MDkwNjAwMDAwMFoXDTI4MDkwNTIzNTk1OVowTDELMAkGA1UEBhMCTFYxDTALBgNV
BAcTBFJpZ2ExETAPBgNVBAoTCEdvR2V0U1NMMRswGQYDVQQDExJHb0dldFNTTCBS
U0EgRFYgQ0EwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQCfwF4hD6E1
kLglXs1n2fH5vMQukCGyyD4LqLsc3pSzeh8we7njU4TB85BH5YXqcfwiH1Sf78aB
hk1FgXoAZ3EQrF49We8mnTtTPFRnMwEHLJRpY9I/+peKeAZNL0MJG5zM+9gmcSpI
OTI6p7MPela72g0pBQjwcExYLqFFVsnroEPTRRlmfTBTRi9r7rYcXwIct2VUCRmj
jR1GX13op370YjYwgGv/TeYqUWkNiEjWNskFDEfxSc0YfoBwwKdPNfp6t/5+RsFn
lgQKstmFLQbbENsdUEpzWEvZUpDC4qPvRrxEKcF0uLoZhEnxhskwXSTC64BNtc+l
VEk7/g/be8svAgMBAAGjggF1MIIBcTAfBgNVHSMEGDAWgBRTeb9aqitKz1SA4dib
wJ3ysgNmyzAdBgNVHQ4EFgQU+ftQxItnu2dk/oMhpqnOP1WEk5kwDgYDVR0PAQH/
BAQDAgGGMBIGA1UdEwEB/wQIMAYBAf8CAQAwHQYDVR0lBBYwFAYIKwYBBQUHAwEG
CCsGAQUFBwMCMCIGA1UdIAQbMBkwDQYLKwYBBAGyMQECAkAwCAYGZ4EMAQIBMFAG
A1UdHwRJMEcwRaBDoEGGP2h0dHA6Ly9jcmwudXNlcnRydXN0LmNvbS9VU0VSVHJ1
c3RSU0FDZXJ0aWZpY2F0aW9uQXV0aG9yaXR5LmNybDB2BggrBgEFBQcBAQRqMGgw
PwYIKwYBBQUHMAKGM2h0dHA6Ly9jcnQudXNlcnRydXN0LmNvbS9VU0VSVHJ1c3RS
U0FBZGRUcnVzdENBLmNydDAlBggrBgEFBQcwAYYZaHR0cDovL29jc3AudXNlcnRy
dXN0LmNvbTANBgkqhkiG9w0BAQwFAAOCAgEAXXRDKHiA5DOhNKsztwayc8qtlK4q
Vt2XNdlzXn4RyZIsC9+SBi0Xd4vGDhFx6XX4N/fnxlUjdzNN/BYY1gS1xK66Uy3p
rw9qI8X12J4er9lNNhrsvOcjB8CT8FyvFu94j3Bs427uxcSukhYbERBAIN7MpWKl
VWxT3q8GIqiEYVKa/tfWAvnOMDDSKgRwMUtggr/IE77hekQm20p7e1BuJODf1Q7c
FPt7T74m3chg+qu0xheLI6HsUFuOxc7R5SQlkFvaVY5tmswfWpY+rwhyJW+FWNbT
uNXkxR4v5KOQPWrY100/QN68/j17paKuSXNcsr56snuB/Dx+MACLBdsF35HxPadx
78vkfQ37WcVmKZtHrHJQ/QUyjxdG8fezMsh0f+puUln/O+NlsFtipve8qYa9h/K5
yD0oZN93ChWve78XrV4vCpjO75Nk5B8O9CWQqGTHbhkgvjyb9v/B+sYJqB22/NLl
R4RPvbmqDJGeEI+4u6NJ5YiLIVVsX+dyfFP8zUbSsj6J34RyCYKBbQ4L+r7k8Srs
LY51WUFP292wkFDPSDmV7XsUNTDOZoQcBh2Fycf7xFfxeA+6ERx2d8MpPPND7yS2
1dkf+SY5SdpSbAKtYmbqb9q8cZUDEImNWJFUVHBLDOrnYhGwJudE3OBXRTxNhMDm
IXnjEeWrFvAZQhk=
-----END CERTIFICATE-----`;
const OOFD_INTERMEDIATE_SHA256 =
  '43:CA:C3:1E:F8:E8:BA:1B:4B:16:B8:20:6E:4C:0A:26:C5:BA:DB:2F:C3:AA:09:E9:01:70:E4:1B:66:C2:FD:64';
const USERTRUST_ROOT_SHA256 =
  'E7:93:C9:B0:2F:D8:AA:13:E2:1C:31:22:8A:CC:B0:81:19:64:3B:74:9C:89:89:64:B1:74:6D:46:C3:D4:CB:D2';
const unavailable = () =>
  Object.assign(new Error('Проверка этого фискального чека пока недоступна'), {
    code: 'FORTUNE_RECEIPT_UNAVAILABLE',
    statusCode: 503,
  });
const validAt = (certificate, now) =>
  Number.isFinite(now) &&
  Date.parse(certificate.validFrom) <= now &&
  Date.parse(certificate.validTo) > now;

function createFiscalHttpsAgent(
  provider,
  {
    bundledRoots = tls.rootCertificates,
    defaultRoots = typeof tls.getCACertificates === 'function'
      ? tls.getCACertificates('default')
      : tls.rootCertificates,
    systemRoots = typeof tls.getCACertificates === 'function'
      ? tls.getCACertificates('system')
      : [],
    intermediate = OOFD_INTERMEDIATE_PEM,
    now = Date.now(),
  } = {},
) {
  const authorities = [...new Set([...bundledRoots, ...defaultRoots, ...systemRoots])];
  if (provider === 'oofd') {
    try {
      const issuer = new crypto.X509Certificate(intermediate);
      if (!issuer.ca || issuer.fingerprint256 !== OOFD_INTERMEDIATE_SHA256 || !validAt(issuer, now))
        throw unavailable();
      // Establish the chain to the exact globally trusted, self-signed root
      // already in Node's bundled store. Do not permit partial-chain trust.
      const anchored = bundledRoots.some((pem) => {
        const root = new crypto.X509Certificate(pem);
        return (
          root.fingerprint256 === USERTRUST_ROOT_SHA256 &&
          root.ca &&
          validAt(root, now) &&
          root.checkIssued(root) &&
          root.verify(root.publicKey) &&
          issuer.checkIssued(root) &&
          issuer.verify(root.publicKey)
        );
      });
      if (!anchored) throw unavailable();
      authorities.push(intermediate);
    } catch {
      throw unavailable();
    }
  }
  return new https.Agent({
    ca: authorities,
    minVersion: 'TLSv1.2',
    rejectUnauthorized: true,
    allowPartialTrustChain: false,
  });
}

module.exports = { createFiscalHttpsAgent, OOFD_INTERMEDIATE_PEM };
