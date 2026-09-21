require 'base64'
require 'json'
require 'net/http'
require 'openssl'
require 'uri'

def encoded(value)
  Base64.urlsafe_encode64(value, padding: false)
end

key_text = ENV.fetch('ASC_PRIVATE_KEY').strip
key_text = Base64.strict_decode64(key_text) unless key_text.include?('BEGIN PRIVATE KEY')
key = OpenSSL::PKey.read(key_text.gsub('\\n', "\n"))
header = encoded(JSON.generate(alg: 'ES256', kid: ENV.fetch('ASC_KEY_ID'), typ: 'JWT'))
claims = encoded(JSON.generate(iss: ENV.fetch('ASC_ISSUER_ID'), iat: Time.now.to_i,
                              exp: Time.now.to_i + 600, aud: 'appstoreconnect-v1'))
message = "#{header}.#{claims}"
signature = OpenSSL::ASN1.decode(key.sign(OpenSSL::Digest::SHA256.new, message)).value
raw = signature.map { |part| [part.value.to_i.to_s(16).rjust(64, '0')].pack('H*') }.join
token = "#{message}.#{encoded(raw)}"

read = lambda do |path, query = {}|
  uri = URI("https://api.appstoreconnect.apple.com#{path}")
  uri.query = URI.encode_www_form(query) unless query.empty?
  request = Net::HTTP::Get.new(uri)
  request['Authorization'] = "Bearer #{token}"
  request['Accept'] = 'application/json'
  response = Net::HTTP.start(uri.host, uri.port, use_ssl: true, read_timeout: 30) do |http|
    http.request(request)
  end
  abort("App Store Connect #{response.code} for #{path}") unless response.is_a?(Net::HTTPSuccess)
  JSON.parse(response.body)
end

app = read.call('/v1/apps', 'filter[bundleId]' => 'com.bulka.bonus').fetch('data').first
abort('Bulka app not found') unless app
app_id = app.fetch('id')
versions = read.call("/v1/apps/#{app_id}/appStoreVersions", 'limit' => '10').fetch('data')
builds = read.call('/v1/builds', 'filter[app]' => app_id, 'sort' => '-uploadedDate',
                  'limit' => '10', 'include' => 'preReleaseVersion')
release_versions = builds.fetch('included', []).to_h { |item| [item['id'], item.dig('attributes', 'version')] }
puts JSON.generate(
  appId: app_id,
  versions: versions.map { |v| { id: v['id'], **v.fetch('attributes').slice('versionString', 'appStoreState', 'appVersionState', 'platform') } },
  builds: builds.fetch('data').map do |build|
    { id: build['id'], marketingVersion: release_versions[build.dig('relationships', 'preReleaseVersion', 'data', 'id')],
      **build.fetch('attributes').slice('version', 'processingState', 'expired', 'uploadedDate') }
  end
)
