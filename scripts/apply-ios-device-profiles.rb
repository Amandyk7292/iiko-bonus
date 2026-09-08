require 'json'
require 'xcodeproj'

settings = JSON.parse(File.read(File.join(ENV.fetch('RUNNER_TEMP'), 'bulka-signing', 'targets.json')))
project = Xcodeproj::Project.open('ios/Runner.xcodeproj')
settings.each do |name, signing|
  target = project.targets.find { |candidate| candidate.name == name }
  raise "Missing signing target: #{name}" unless target
  target.build_configurations.each do |configuration|
    configuration.build_settings['CODE_SIGN_STYLE'] = 'Manual'
    configuration.build_settings['DEVELOPMENT_TEAM'] = signing.fetch('team')
    configuration.build_settings['CODE_SIGN_IDENTITY'] = signing.fetch('identity')
    configuration.build_settings['PROVISIONING_PROFILE_SPECIFIER'] = signing.fetch('profile')
    configuration.build_settings['CODE_SIGN_ENTITLEMENTS'] = signing.fetch('entitlements')
  end
end
project.save
puts 'Applied signing profiles to Runner and BulkaWidget.'
