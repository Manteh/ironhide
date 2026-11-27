import { Config } from '@remotion/cli/config';
Config.setBrowserExecutable('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
Config.setChromiumOpenGlRenderer('angle');
Config.setConcurrency(2);
Config.setOverwriteOutput(true);
