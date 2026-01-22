#!/bin/bash
set -e
cd android
JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" ./gradlew installDebug
adb shell am start -n it.detach.app/.MainActivity