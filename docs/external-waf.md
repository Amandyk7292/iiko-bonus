# External WAF and DDoS protection

`bulka.com.kz` currently resolves directly to the VPS and uses the Hoster.kz
nameservers. External filtering therefore requires an account-level DNS change;
it cannot be activated safely from the application server alone.

## Cloudflare activation

1. Add `bulka.com.kz` to the Cloudflare account and copy every existing DNS
   record, including mail-related MX, TXT and DKIM records.
2. Keep mail records DNS-only. Enable the proxy for the web `A` record pointing
   to the Bulka origin.
3. Set SSL/TLS mode to `Full (strict)`, enable Always Use HTTPS and leave the
   existing origin certificate in place.
4. Enable the Cloudflare Free Managed Ruleset and DDoS protection. Review Bot
   Fight Mode separately because payment, monitoring and webhook traffic must
   not receive an interactive challenge.
5. Replace `ns1.hoster.kz`, `ns2.hoster.kz`, `ns3.hoster.kz` at the registrar
   with the two nameservers assigned by Cloudflare.
6. Wait until Cloudflare reports the zone as active. Verify that the public
   response contains `CF-Ray` and that public DNS no longer exposes the origin
   address.
7. Run `sudo CONFIRM_CLOUDFLARE_ACTIVE=bulka.com.kz
   /var/www/iiko-bonus/scripts/prepare-cloudflare-origin.sh`. This restores the
   real visitor address in Nginx and rejects direct web requests that bypass
   Cloudflare.
8. Ask the VPS provider to rotate the historically exposed origin IP and enable
   its network-level DDoS filter. Cloudflare cannot filter packets sent directly
   to an origin address that an attacker already knows.

Do not run the origin-lockdown script before the nameserver switch is active.
Doing so would make the website unavailable.

Official references:

- https://developers.cloudflare.com/waf/get-started/
- https://developers.cloudflare.com/fundamentals/security/protect-your-origin-server/
- https://developers.cloudflare.com/fundamentals/concepts/cloudflare-ip-addresses/
