; Sahifa PDF by MV Digital Tools: extra Windows registration.
; Registers the app as a PDF handler with "Capabilities" so it is listed in
; Settings > Apps > Default apps and in the "Open with" dialog. Windows 10/11
; still require the user to confirm the default; the app guides them on first run.

!define SAHIFA_PROGID "MVDigitalTools.SahifaPDF.Document"
!define SAHIFA_CAPS "Software\MV Digital Tools\Sahifa PDF\Capabilities"

!macro customInstall
  WriteRegStr SHCTX "Software\Classes\${SAHIFA_PROGID}" "" "PDF Document"
  WriteRegStr SHCTX "Software\Classes\${SAHIFA_PROGID}" "FriendlyTypeName" "PDF Document"
  WriteRegStr SHCTX "Software\Classes\${SAHIFA_PROGID}\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHCTX "Software\Classes\${SAHIFA_PROGID}\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
  WriteRegStr SHCTX "Software\Classes\${SAHIFA_PROGID}\Application" "ApplicationName" "Sahifa PDF"
  WriteRegStr SHCTX "Software\Classes\${SAHIFA_PROGID}\Application" "ApplicationCompany" "MV Digital Tools"
  WriteRegStr SHCTX "Software\Classes\.pdf\OpenWithProgids" "${SAHIFA_PROGID}" ""
  WriteRegStr SHCTX "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}" "FriendlyAppName" "Sahifa PDF"
  WriteRegStr SHCTX "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".pdf" ""
  WriteRegStr SHCTX "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
  WriteRegStr SHCTX "${SAHIFA_CAPS}" "ApplicationName" "Sahifa PDF"
  WriteRegStr SHCTX "${SAHIFA_CAPS}" "ApplicationDescription" "Free PDF reader and editor by MV Digital Tools"
  WriteRegStr SHCTX "${SAHIFA_CAPS}" "ApplicationIcon" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHCTX "${SAHIFA_CAPS}\FileAssociations" ".pdf" "${SAHIFA_PROGID}"
  WriteRegStr SHCTX "Software\RegisteredApplications" "Sahifa PDF" "${SAHIFA_CAPS}"
  ; Tell Explorer that file associations changed.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  DeleteRegKey SHCTX "Software\Classes\${SAHIFA_PROGID}"
  DeleteRegValue SHCTX "Software\Classes\.pdf\OpenWithProgids" "${SAHIFA_PROGID}"
  DeleteRegKey SHCTX "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}"
  DeleteRegKey SHCTX "Software\MV Digital Tools\Sahifa PDF"
  DeleteRegKey /ifempty SHCTX "Software\MV Digital Tools"
  DeleteRegValue SHCTX "Software\RegisteredApplications" "Sahifa PDF"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
