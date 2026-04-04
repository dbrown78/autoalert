const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Adds a post_install hook to the generated Podfile that suppresses
 * -Werror,-Wreturn-type across all pod targets.
 */
const withSuppressReturnTypeWarning = (config) => {
  return withDangerousMod(config, [
    'ios',
    (config) => {
      const podfilePath = path.join(config.modRequest.platformProjectRoot, 'Podfile');
      let podfile = fs.readFileSync(podfilePath, 'utf8');

      if (!podfile.includes('-Wno-error=return-type')) {
        const patch = [
          '    # Suppress -Werror,-Wreturn-type in third-party pods',
          '    installer.pods_project.targets.each do |target|',
          '      target.build_configurations.each do |config|',
          "        config.build_settings['OTHER_CFLAGS'] = '$(inherited) -Wno-error=return-type'",
          '      end',
          '    end',
        ].join('\n');

        // Insert before the closing `end` of the post_install block
        podfile = podfile.replace(
          /(  post_install do \|installer\|[\s\S]*?)(^  end)/m,
          `$1${patch}\n$2`
        );

        fs.writeFileSync(podfilePath, podfile);
      }

      return config;
    },
  ]);
};

module.exports = withSuppressReturnTypeWarning;
