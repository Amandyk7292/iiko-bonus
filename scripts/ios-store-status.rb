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

api = lambda do |method, path, query = {}, data = nil, missing: false|
  uri = URI("https://api.appstoreconnect.apple.com#{path}")
  uri.query = URI.encode_www_form(query) unless query.empty?
  request = method.new(uri)
  request['Authorization'] = "Bearer #{token}"
  request['Accept'] = 'application/json'
  if data
    request['Content-Type'] = 'application/json'
    request.body = JSON.generate(data: data)
  end
  response = Net::HTTP.start(uri.host, uri.port, use_ssl: true, read_timeout: 30) do |http|
    http.request(request)
  end
  next nil if missing && response.code == '404'
  unless response.is_a?(Net::HTTPSuccess)
    errors = JSON.parse(response.body).fetch('errors', []) rescue []
    summary = errors.map { |error| error.slice('code', 'title', 'source') }
    abort("App Store Connect #{response.code} for #{request.method} #{path}: #{JSON.generate(summary)}")
  end
  response.body.to_s.empty? ? nil : JSON.parse(response.body)
end
read = ->(path, query = {}) { api.call(Net::HTTP::Get, path, query) }
post = ->(path, data) { api.call(Net::HTTP::Post, path, {}, data).fetch('data') }
patch = ->(path, data) { api.call(Net::HTTP::Patch, path, {}, data) }
relationship = ->(type, id) { { data: { type: type, id: id } } }

app = read.call('/v1/apps', 'filter[bundleId]' => 'com.bulka.bonus').fetch('data').first
abort('Bulka app not found') unless app
app_id = app.fetch('id')
versions = read.call("/v1/apps/#{app_id}/appStoreVersions", 'limit' => '10').fetch('data')
builds = read.call('/v1/builds', 'filter[app]' => app_id, 'sort' => '-uploadedDate',
                  'limit' => '10', 'include' => 'preReleaseVersion')
release_versions = builds.fetch('included', []).to_h { |item| [item['id'], item.dig('attributes', 'version')] }

if ARGV == ['submit-1.0.10-build-52']
  $stdout.sync = true
  abort('Unexpected Bulka App Store account') unless app_id == '6811576637'
  version_number = '1.0.10'
  build_id = '07d81c90-75e1-4b82-83af-6a598bd61bf8'
  release_type = 'AFTER_APPROVAL'
  versions = versions.select { |version| version.dig('attributes', 'platform') == 'IOS' }
  live_version = versions.find { |version| version.dig('attributes', 'appVersionState') == 'READY_FOR_DISTRIBUTION' }
  version = versions.find { |entry| entry.dig('attributes', 'versionString') == version_number }
  build = read.call("/v1/builds/#{build_id}", 'include' => 'app,preReleaseVersion')
  build_data = build.fetch('data')
  build_release_id = build_data.dig('relationships', 'preReleaseVersion', 'data', 'id')
  build_release = build.fetch('included').find { |item| item['id'] == build_release_id }.fetch('attributes')
  abort('Incorrect or unprocessed build') unless
    build_data.dig('relationships', 'app', 'data', 'id') == app_id &&
    build_data.dig('attributes', 'version') == '52' &&
    build_data.dig('attributes', 'processingState') == 'VALID' &&
    build_data.dig('attributes', 'expired') == false &&
    build_release.values_at('platform', 'version') == ['IOS', version_number]

  active_states = %w[WAITING_FOR_REVIEW IN_REVIEW PENDING_DEVELOPER_RELEASE PROCESSING_FOR_DISTRIBUTION READY_FOR_DISTRIBUTION]
  if version && active_states.include?(version.dig('attributes', 'appVersionState'))
    attached = read.call("/v1/appStoreVersions/#{version['id']}/relationships/build").dig('data', 'id')
    abort('Existing submission has different settings') unless
      attached == build_id && version.dig('attributes', 'releaseType') == release_type
    puts JSON.generate(versionId: version['id'], state: version.dig('attributes', 'appVersionState'), build: '52', releaseType: release_type)
    exit
  end
  abort('Unexpected current App Store version') unless live_version&.dig('attributes', 'versionString') == '1.0.9'
  abort('Unexpected draft state') if version &&
    !%w[PREPARE_FOR_SUBMISSION READY_FOR_REVIEW].include?(version.dig('attributes', 'appVersionState'))

  unless version
    attributes = { platform: 'IOS', versionString: version_number, releaseType: release_type }
    copyright = live_version.dig('attributes', 'copyright')
    attributes[:copyright] = copyright unless copyright.to_s.empty?
    version = post.call('/v1/appStoreVersions', {
      type: 'appStoreVersions', attributes: attributes, relationships: { app: relationship.call('apps', app_id) }
    })
  end
  version_id = version.fetch('id')
  puts "App Store version #{version_number}: #{version_id}"
  version_path = "/v1/appStoreVersions/#{version_id}"
  attached = read.call("#{version_path}/relationships/build").dig('data', 'id')
  abort('Draft contains a different build') if attached && attached != build_id
  patch.call(version_path, {
    type: 'appStoreVersions', id: version_id, attributes: { releaseType: release_type },
    relationships: { build: relationship.call('builds', build_id) }
  })

  whats_new = {
    'ru' => 'Улучшили отслеживание доставки и управление картой. Статусы заказа на экране блокировки теперь учитывают доставку и самовывоз.',
    'en' => 'Improved delivery tracking and map controls. Lock Screen order updates now distinguish delivery from pickup.',
    'kk' => 'Жеткізуді қадағалау мен картаны басқару жақсарды. Құлыптау экранында жеткізу мен алып кету мәртебелері бөлек көрсетіледі.'
  }
  localizations = read.call("#{version_path}/appStoreVersionLocalizations", 'limit' => '50').fetch('data')
  previous_localizations = read.call("/v1/appStoreVersions/#{live_version['id']}/appStoreVersionLocalizations",
                                    'limit' => '50').fetch('data')
  previous_locales = previous_localizations.map { |item| item.dig('attributes', 'locale') }
  locales = localizations.map { |item| item.dig('attributes', 'locale') }
  abort('Previous App Store localizations were not inherited') if locales.empty? || !(previous_locales - locales).empty?
  localizations.each do |localization|
    id = localization.fetch('id')
    locale = localization.dig('attributes', 'locale')
    notes = whats_new.fetch(locale.split('-').first, whats_new['en'])
    patch.call("/v1/appStoreVersionLocalizations/#{id}", {
      type: 'appStoreVersionLocalizations', id: id, attributes: { whatsNew: notes }
    })
  end
  puts "Updated release notes for #{locales.join(', ')}"

  detail = api.call(Net::HTTP::Get, "#{version_path}/appStoreReviewDetail", {}, nil, missing: true)&.fetch('data')
  unless detail
    previous_detail = read.call("/v1/appStoreVersions/#{live_version['id']}/appStoreReviewDetail").fetch('data')
    details = previous_detail.fetch('attributes').slice(
      'contactFirstName', 'contactLastName', 'contactPhone', 'contactEmail',
      'demoAccountName', 'demoAccountPassword', 'demoAccountRequired', 'notes'
    )
    post.call('/v1/appStoreReviewDetails', {
      type: 'appStoreReviewDetails', attributes: details,
      relationships: { appStoreVersion: relationship.call('appStoreVersions', version_id) }
    })
  end

  submissions = read.call("/v1/apps/#{app_id}/reviewSubmissions", 'limit' => '50',
                          'filter[platform]' => 'IOS', 'include' => 'appStoreVersionForReview').fetch('data')
  draft = submissions.find do |item|
    item.dig('attributes', 'state') == 'READY_FOR_REVIEW' &&
      item.dig('relationships', 'appStoreVersionForReview', 'data', 'id') == version_id
  end
  unless draft
    draft = post.call('/v1/reviewSubmissions', {
      type: 'reviewSubmissions', attributes: { platform: 'IOS' }, relationships: { app: relationship.call('apps', app_id) }
    })
    post.call('/v1/reviewSubmissionItems', {
      type: 'reviewSubmissionItems', relationships: {
        reviewSubmission: relationship.call('reviewSubmissions', draft.fetch('id')),
        appStoreVersion: relationship.call('appStoreVersions', version_id)
      }
    })
  end
  submission_id = draft.fetch('id')
  items = read.call("/v1/reviewSubmissions/#{submission_id}/items", 'include' => 'appStoreVersion').fetch('data')
  abort('Unexpected review items') unless items.size == 1 &&
    items.first.dig('relationships', 'appStoreVersion', 'data', 'id') == version_id
  submitted = patch.call("/v1/reviewSubmissions/#{submission_id}", {
    type: 'reviewSubmissions', id: submission_id, attributes: { submitted: true }
  }).fetch('data')
  verified = read.call(version_path).fetch('data').fetch('attributes')
  abort('Apple has not confirmed review submission') unless
    %w[WAITING_FOR_REVIEW IN_REVIEW].include?(submitted.dig('attributes', 'state')) &&
    verified['releaseType'] == release_type
  puts JSON.generate(versionId: version_id, build: '52', releaseType: verified['releaseType'],
                     state: verified['appVersionState'], submissionId: submission_id,
                     submissionState: submitted.dig('attributes', 'state'))
  exit
end

puts JSON.generate(
  appId: app_id,
  versions: versions.map { |v| { id: v['id'], **v.fetch('attributes').slice('versionString', 'appStoreState', 'appVersionState', 'platform') } },
  builds: builds.fetch('data').map do |build|
    { id: build['id'], marketingVersion: release_versions[build.dig('relationships', 'preReleaseVersion', 'data', 'id')],
      **build.fetch('attributes').slice('version', 'processingState', 'expired', 'uploadedDate') }
  end
)
