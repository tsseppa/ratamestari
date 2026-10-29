import type { FindingLimits, FindingText, Messages, StopName } from '.'

// Terms follow Suomen Suunnistusliitto's Lajisäännöt 2026 and Ratamestarikirja: rata, rasti,
// rastiväli, rastinmääritteet, kilpailukeskus, sarja, taitotaso, voittoaika.

const stopWord = (stop: StopName) =>
  typeof stop === 'number' ? String(stop) : stop === 'start' ? 'lähtö' : 'maali'

// Finding texts need the stop in different cases: nominative, adessive ("rastilla 3"),
// genitive ("rastin 3").
const nominative = (stop: number, finishStop: number) =>
  stop === 0 ? 'lähtö' : stop === finishStop ? 'maali' : `rasti ${stop}`
const adessive = (stop: number, finishStop: number) =>
  stop === 0 ? 'lähdössä' : stop === finishStop ? 'maalissa' : `rastilla ${stop}`
const genitive = (stop: number, finishStop: number) =>
  stop === 0 ? 'lähdön' : stop === finishStop ? 'maalin' : `rastin ${stop}`
const shortStop = (stop: number, finishStop: number) =>
  stop === 0 ? 'L' : stop === finishStop ? 'M' : String(stop)
const lineNamed = (from: number, to: number, finishStop: number) =>
  `rastiväliviiva ${shortStop(from, finishStop)}–${shortStop(to, finishStop)}`
const lineGenitive = (from: number, to: number, finishStop: number) =>
  `rastiväliviivan ${shortStop(from, finishStop)}–${shortStop(to, finishStop)}`

const findingTexts = {
  spacing: ([a = 0, b = 0], f) =>
    `${nominative(a, f)} ja ${nominative(b, f)} ovat liian lähellä toisiaan`,
  acuteAngleWarnings: ([a = 0], f, { sharpAngleDegrees }: FindingLimits) =>
    `terävä, alle ${sharpAngleDegrees}°:n kulma ${adessive(a, f)}`,
  acuteAngleNotes: ([a = 0], f, { angleNoteDegrees }: FindingLimits) =>
    `alle ${angleNoteDegrees}°:n kulma ${adessive(a, f)}`,
  difficultyOutsideRange: ([a = 0], f) =>
    `${nominative(a, f)} ei vastaa sarjan teknistä vaikeustasoa`,
  courseLineCrossings: ([a = 0, b = 0, c = 0, d = 0], f) =>
    `${lineNamed(a, b, f)} risteää ${lineGenitive(c, d, f)} kanssa`,
  courseLinesThroughControls: ([a = 0, b = 0, c = 0], f) =>
    `${lineNamed(a, b, f)} kulkee ${genitive(c, f)} rastiympyrän läpi`,
  courseLinesOutsideMap: ([a = 0, b = 0], f) =>
    `${lineNamed(a, b, f)} menee kartoitetun alueen ulkopuolelle`,
  courseLinesOverDescriptions: ([a = 0, b = 0], f) =>
    `${lineNamed(a, b, f)} kulkee rastinmääritteiden alta`,
  stopsOutsidePrintArea: ([a = 0], f) => `${nominative(a, f)} on tulostusalueen ulkopuolella`,
  overlappingCircles: ([a = 0, b = 0], f) =>
    `${genitive(a, f)} ja ${genitive(b, f)} rastiympyrät menevät päällekkäin`,
  winningTimeOutsideRange: () =>
    'rata ei yllä sarjan voittoaikaan; kilpailukeskuksen ympärillä tai valitulla tulostusalueella voi olla liian vähän maastoa tälle sarjalle',
  controlsWithoutFeature: ([a = 0], f, { featureMatchMetres }: FindingLimits) =>
    `${genitive(a, f)} ${featureMatchMetres} metrin säteellä ei ole kartalla kohdetta; tarkista paikka`,
  finalLegTooLong: () => 'viimeinen rastiväli maaliin on pitkä',
} satisfies Record<keyof Messages['findings']['texts'], FindingText>

export const fi: Messages = {
  leg: {
    title: (from, to) =>
      from === 'start' ? `Lähtö – ${stopWord(to)}` : `Rastiväli ${from}–${stopWord(to)}`,
    straightLine: distance => `${distance} linnuntietä`,
    previous: 'Edellinen rastiväli',
    next: 'Seuraava rastiväli',
    wholeCourse: 'Koko rata',
    route: 'Reitti',
    length: 'Pituus',
    time: 'Aika',
    routeLetters: ['A', 'B', 'C'],
    slowerBy: difference => `+${difference}`,
    fastestClimb: climb => `Nopeimmalla reitillä on nousua noin ${climb}.`,
    routeChoice: (letter, difference) =>
      `Todellinen reitinvalinta: ${letter} kulkee eri kautta ja on vain ${difference} hitaampi.`,
    noRouteChoice: share => `Ei selvästi erilaista reittiä ${share}:n sisällä nopeimmasta.`,
    findingRoutes: 'Etsitään reittejä…',
    unreachable: 'Ei reittiä: rasti on kulkukelvottomalla tai kielletyllä alueella.',
    fromSymbols: 'Reitit lasketaan kartan merkeistä, ei GPS-jäljistä.',
    selectHint: 'Napauta kartalla rastiväliä tai rastia nähdäksesi sen reitit.',
  },
  workspace: {
    settings: 'Asetukset',
    showMore: 'Näytä paneelia enemmän',
    showLess: 'Näytä paneelia vähemmän',
    openMap: 'Avaa OCAD-kartta',
    openMapHint: 'Pudota .ocd-tiedosto mihin tahansa tähän ikkunaan tai valitse se.',
    pdfWithoutMap: 'Tästä PDF:stä ei löytynyt karttaa.',
    pdfIsPicture:
      'Tässä PDF:ssä kartta on kuvana, esimerkiksi skannauksena, eikä piirroksena. Toistaiseksi voidaan lukea vain piirrettyjä karttoja, kuten OCADista tai Condesista vietyjä.',
    printedCourse: 'Kartalle painettu rata',
    openMapHintWithPdf:
      'Pudota .ocd-tiedosto tai kartan PDF mihin tahansa tähän ikkunaan tai valitse se.',
    dropToOpen: 'Pudota kartta avataksesi sen',
    chooseFile: 'Valitse karttatiedosto',
    opening: fileName => `Avataan ${fileName}…`,
    openingHint: 'Karttaa luetaan ja piirretään. Suurissa kartoissa menee muutama sekunti.',
    openFailed: reason => `Tiedostoa ei voitu avata: ${reason}`,
    privacy: 'Kartta luetaan tässä selaimessa eikä sitä lähetetä minnekään.',
    sampleCredit:
      'Esimerkkikartta: Leirikangas, Hamina. © Vehkalahden Veikot, vain Ratamestarin kokeilemiseen.',
    sampleFailed: reason => `Esimerkkikarttaa ei voitu ladata: ${reason}`,
    mapLine: 'Kartta',
    contourIntervalLine: 'Käyräväli',
    changeContourInterval: 'Vaihda',
    infoGlyph: '?',
    contourIntervalInfo: 'Mistä käyräväli tulee',
    contourIntervalFromMap: 'Luettu kartasta. Nousu ja reitit lasketaan sen mukaan.',
    contourIntervalStandard: interval =>
      `Kartassa ei mainita käyräväliä, joten käytetään normaalia ${interval}. Muuta, jos kartta on piirretty toisin.`,
    contourIntervalSetByYou: 'Asetettu itse tälle kartalle. Nousu ja reitit lasketaan sen mukaan.',
    contourIntervalReset: 'Palauta',
    noMap: 'Karttaa ei ole vielä avattu',
    openingLine: fileName => `Avataan ${fileName}…`,
    mapValue: (fileName, scale) => `${fileName}, ${scale}`,
    changeMap: 'Vaihda',
    centreLine: 'Kilpailukeskus',
    afterMap: 'Kartan jälkeen',
    courseLine: 'Rata',
    afterCentre: 'Kilpailukeskuksen jälkeen',
    guides: 'Ohjeet',
    sourceCode: 'Lähdekoodi',
    version: version => `Versio ${version}`,
    licence: 'AGPL-3.0-or-later',
    ocadReading: 'OCAD-tiedostot lukee',
  },
  settings: {
    title: 'Asetukset',
    close: 'Sulje asetukset',
    assistant: 'Avustaja',
    assistantIntro:
      'Vapaaehtoinen. Pyydä ratoja ja muutoksia omin sanoin. Kaikki muu toimii ilman sitä.',
    assistantOn: 'Avustaja on päällä. Voit kirjoittaa sille sivupaneelissa.',
    apiKey: 'Oma Claude API -avaimesi',
    keyStorage: 'Säilytetään vain tässä selaimessa ja lähetetään vain Anthropicille.',
    getKey: 'Hanki avain',
    turnOn: 'Ota avustaja käyttöön',
    turnOff: 'Poista käytöstä ja unohda avain',
    receives: 'Se saa',
    receivesText: 'Viestisi, radan luvut, sääntötarkistusten tulokset ja rastinmääritteet sanoina.',
    neverReceives: 'Se ei koskaan saa',
    neverReceivesText: 'Karttatiedostoa, koordinaatteja tai mitään geometriaa.',
    course: 'Rata',
    pace: 'Voittajan vauhti',
    paceHint: 'Muuttaa radan pituuden voittoajaksi.',
    paceUnit: 'min/km',
    paceInvalid: 'Kirjoita vauhti minuutteina ja sekunteina, esimerkiksi 5:00.',
    map: 'Kartta',
    fileName: 'Tiedosto',
    scale: 'Mittakaava',
    objects: 'Kohteita',
    coordinateSystem: 'Koordinaattijärjestelmä',
    noCoordinateSystem: 'ei ole',
    image: 'Kuva',
    imageValue: (width, height, milliseconds) =>
      `${width} × ${height} px, piirretty ${milliseconds} ms:ssa`,
    backgroundMaps: 'Taustakartat',
    licence: 'Ratamestarin lisenssi on AGPL-3.0-or-later.',
    sourceCode: 'Lähdekoodi',
    version: version => `Versio ${version}`,
    experimental: 'Kokeelliset ominaisuudet',
    experimentalIntro:
      'Ominaisuuksia, joita vielä hiotaan. Niiden tulokset voivat olla vääriä, joten tarkista ne ennen kuin luotat niihin.',
    experimentalPdf: 'Avaa kartta PDF:stä ja lue siihen painettu rata.',
    experimentalOn: 'Kokeelliset ominaisuudet ovat päällä.',
    experimentalOff: 'Kokeelliset ominaisuudet ovat pois päältä.',
    turnOffExperimental: 'Poista kokeelliset ominaisuudet käytöstä',
    printScale: 'PDF:n tulostusmittakaava',
    printScaleHint: 'Arvioitu merkkien koosta. Muuta sitä, jos PDF:ssä lukee toisin.',
    printScaleFromGeoreference:
      'Luettu PDF:n koordinaateista. Muussa mittakaavassa kartalla ei ole koordinaatteja.',
  },
  course: {
    centreLine: 'Kilpailukeskus',
    centreChosen: 'Valittu kartalta',
    change: 'Vaihda',
    centreQuestion: 'Missä kilpailukeskus on?',
    centreHint: 'Napsauta sitä kartalla. Rata alkaa ja päättyy sen lähellä.',
    courseLine: 'Rata',
    eventLevel: 'Kilpailun taso',
    eventLevels: { national: 'Kansallisen tason', finnishChampionship: 'SM-tason' },
    purposeLine: 'Radan tyyppi',
    purposes: { competition: 'Kisarata', training: 'Harjoitusrata' },
    trainingKind: 'Harjoituksen laji',
    trainingKinds: { contour: 'Käyräkarttaharjoitus' },
    trainingStyle: 'Harjoituksen tyyppi',
    trainingStyles: { controlPicking: 'rastinotto', longLegs: 'pitkät välit' },
    contourTrainingNote:
      'Voittoajan valitset itse; muut arvot ovat Ratamestarin oletuksia, eivät IOF:n tai SSL:n sääntöjä.',
    trainingMinutes: 'Harjoituksen voittoaika minuutteina',
    beforeTrainingMinutes: ', ',
    distance: 'Matka',
    formats: { long: 'pitkä matka', middle: 'keskimatka' },
    forClass: 'sarjalle',
    beforeSkillLevel: ', ',
    className: 'Sarja',
    sexes: { H: 'Miehet ja pojat (H)', D: 'Naiset ja tytöt (D)' },
    skillLevel: 'Taitotaso',
    skillLevelOption: letter => `taitotaso ${letter}`,
    skillLevels: {
      E: 'Taitotaso E ratamestaroidaan kuten A-sarja.',
      A: 'Taitotaso A on pääsarja: sarjan oma voittoaika ja vaikeustaso.',
      B: 'Taitotaso B on helpompi: kaksi väritasoa helpompi ja 75 % A-sarjan voittoajasta.',
      C: 'Taitotaso C on aloittelijoille: keltainen vaikeustaso ja 75 % A-sarjan voittoajasta.',
    },
    length: 'Pituus',
    climb: 'Nousu',
    winningTime: 'Voittoaika',
    minutes: minutes => `${minutes} min`,
    target: time => `tavoite ${time}`,
    controls: 'Rastit',
    measuring: 'mitataan…',
    noFindings: 'Sääntöongelmia ei löytynyt',
    findingCount: count => (count === 1 ? '1 tarkistettava asia' : `${count} tarkistettavaa asiaa`),
    severities: { error: 'Virhe', warning: 'Varoitus', note: 'Huomio' },
    fix: 'Korjaa',
    fixControl: control => `Korjaa rasti ${control}`,
    dragHint:
      'Vedä rastia, lähtöä tai maalia kartalla siirtääksesi sitä. Säännöt tarkistetaan uudelleen.',
    dragHintTouch: 'Napauta rastiväliä ja vedä sitten sen rastia. Säännöt tarkistetaan uudelleen.',
    setCourse: 'Tee rata',
    setting: 'Rataa tehdään…',
    stop: 'Pysäytä',
    stopHint: 'Pysäytys säilyttää parhaan tähän mennessä löytyneen radan.',
    searchPhases: {
      areas: 'Etsitään teknisiä alueita…',
      skeleton: 'Suunnitellaan rataa…',
      sections: 'Tehdään radan osia…',
      improving: 'Parannetaan…',
      checking: 'Tarkistetaan sääntöjä…',
    },
    downloadPdf: 'Lataa PDF',
    preparingPdf: 'PDF:ää tehdään…',
    downloadXml: 'IOF XML',
    tryAnother: 'Kokeile toista rataa',
    exportNote:
      'PDF on tulostettava sivu, jossa on rata ja rastinmääritteet. IOF XML 3.0 aukeaa OCADissa, Condesissa ja Purple Penissä.',
    classReplaced: (level, distance, from, to) =>
      `${level} ${distance}: säännöissä ei ole sarjaa ${from}, joten sarjaksi vaihtui ${to}.`,
    noCourse:
      'Rataa ei saatu tehtyä tästä. Kokeile toista kilpailukeskusta tai toista sarjaa tai matkaa.',
    generationFailed: reason => `Rataa ei voitu tehdä: ${reason}`,
    moveRefused: '60 metrin säteellä ei ole rastipaikkaa, joten rasti jäi paikalleen.',
    fixRefused: 'Rastia ei voitu korjata.',
    pdfFailed: reason => `PDF:ää ei voitu tehdä: ${reason}`,
  },
  check: {
    entry: 'Tai tarkista OCADissa tai Purple Penissä tekemäsi rata:',
    openFile: 'avaa sen IOF XML -tiedosto',
    fileLine: 'Ratatiedosto',
    close: 'Sulje',
    coursesLabel: 'Tiedoston radat',
    checking: 'Rataa tarkistetaan…',
    notOnMap: 'Tämän tiedoston rastit eivät ole tällä kartalla.',
    noCourses: 'Tiedostossa ei ole ratoja.',
    readFailed: reason => `Ratatiedostoa ei voitu lukea: ${reason}`,
    openMapFirst: 'Avaa ensin kartta, jolle rata on tehty, ja sitten ratatiedosto.',
    checkedAs: 'Tarkistettu sarjana',
    fitsBest: 'Sopii parhaiten',
    classSentence: (level, distance, courseClass, letter) =>
      `${level} ${distance} sarjalle ${courseClass}, taitotaso ${letter}`,
    timeInside: (estimate, range) => `Voittoaika noin ${estimate}, sarjan ${range} sisällä.`,
    timeOutside: (estimate, difference, isLonger, range) =>
      `Voittoaika noin ${estimate}, ${difference} ${isLonger ? 'pidempi' : 'lyhyempi'} kuin sarjan ${range}.`,
    minuteRange: (shortest, longest) => `${shortest}–${longest} min`,
    difficultyFits: 'Jokainen rasti on sarjan vaikeustasolla.',
    difficultyMisfits: count =>
      count === 1
        ? '1 rasti on sarjan vaikeustason ulkopuolella.'
        : `${count} rastia on sarjan vaikeustason ulkopuolella.`,
    alsoFits: classes => `Sopii myös: ${classes.join('; ')}.`,
    classFromName:
      'Sarja on päätelty radan nimestä. Taso ja matka on päätelty voittoajasta ja rastien vaikeudesta.',
    classFromCourse:
      'Taso, matka ja sarja on päätelty voittoajasta ja rastien vaikeudesta. Voittoaika lasketaan asetusten voittajan vauhdilla.',
    checkAsOther: 'Tarkista toisena sarjana',
    chosenByYou: 'Tarkistettu valitsemasi sarjana.',
    deduceAgain: 'Päättele sarja radasta',
    yourFile: 'Tiedostosi',
    measured: 'Mitattu',
    notGiven: 'ei annettu',
    mismatch: distance =>
      `Tiedoston maastokoordinaatit ovat ${distance} päässä siitä, mihin sen karttakoordinaatit osuvat tällä kartalla. Onko rata tehty kartan toiseen versioon?`,
    descriptionsNote:
      'Kartalla näkyvät rastinmääritteet on ehdotettu kartan perusteella. IOF XML -tiedostoissa niitä ei ole.',
    suggest: 'Ehdota',
    suggestControl: control => `Ehdota rastille ${control} parempaa paikkaa`,
    suggestion: control => `Rastin ${control} parempi paikka näkyy kartalla katkoviivalla.`,
    noSuggestion: control => `Rastille ${control} ei löytynyt parempaa paikkaa.`,
    moveHere: 'Siirrä tähän',
    keepMine: 'Pidä omani',
  },
  chat: {
    title: 'Avustaja',
    empty:
      'Pyydä rataa tai muutosta omin sanoin, esimerkiksi ”SM-keskimatka sarjalle D16” tai ”tee rastivälistä 5 vaikeampi”.',
    inputLabel: 'Viesti avustajalle',
    placeholder: 'Pyydä rataa tai muutosta…',
    send: 'Lähetä',
    stop: 'Pysäytä vastaus',
  },
  map: {
    toolbar: 'Karttatyökalut',
    zoomIn: 'Lähennä',
    zoomOut: 'Loitonna',
    layers: 'Tasot',
    costMap: 'Kulkukelpoisuus',
    costMapLegend:
      'Sininen on nopeaa (polut, avoin maa), läpinäkyvä tavallista metsää, oranssi hidasta ja tummempi hitaampaa, punainen kulkukelvotonta tai kiellettyä.',
    sites: 'Mahdolliset rastipaikat',
    courseRoutes: 'Kaikkien rastivälien reitit',
    courseRoutesLegend: share =>
      `Nopein reitti vihreä; muut todelliset reitit sininen ja punainen, enintään ${share} hitaampia.`,
    siteCount: count => `${count} paikkaa.`,
    difficulty: 'Vaikeus 1 (helppo) – 5 (vaikea):',
    planLeg: 'Suunnittele rastiväli',
    editControls: 'Muokkaa rasteja',
    building: 'Maastoa luetaan…',
    engineError: 'Ratamoottori ei pystynyt lukemaan tätä karttaa.',
  },
  print: {
    scaleLine: (scale, contourInterval) =>
      contourInterval === null ? scale : `${scale} · käyräväli ${contourInterval}`,
    adjust: 'Tulostusasetukset',
    paper: 'Paperi',
    scale: 'Mittakaava',
    automaticPaper: 'Automaattinen (A4, tarvittaessa A3)',
    automaticPaperShort: 'Automaattinen paperi',
    automaticScale: scale => `Automaattinen (${scale})`,
    orientation: { portrait: 'pysty', landscape: 'vaaka' },
    onPaper: (paper, orientation, scale) => `${paper} ${orientation}, ${scale}`,
    beforeCourse: (paper, scale) => `${paper}, ${scale}`,
    refitFailed: 'Rata ei mahdu tälle paperille tässä mittakaavassa.',
    chooseArea: 'Valitse tulostusalue',
    moveArea: 'Siirrä tulostusaluetta',
    placedByYou: summary => `${summary}, sinun sijoittamasi`,
    placingHint: 'Vedä paperi kohtaan, johon rata tulee.',
    placingHintTouch: 'Paina paperia pitkään ja vedä se kohtaan, johon rata tulee.',
    turn: 'Käännä',
    turnLabel: 'Käännä paperi',
    automaticArea: 'Automaattinen',
    automaticAreaLabel: 'Anna Ratamestarin sijoittaa paperi',
    done: 'Valmis',
    setAgainInArea: 'Tee rata uudelleen tälle alueelle',
    centreOutside:
      'Kilpailukeskus on tulostusalueen ulkopuolella, joten lähtö ja maali jäisivät paperin ulkopuolelle. Siirrä paperi kilpailukeskuksen päälle tai siirrä kilpailukeskusta.',
  },
  planLeg: {
    open: 'Suunnittele rastiväli',
    title: 'Suunnittele rastiväli',
    done: 'Valmis',
    placeFirst: 'Napsauta kartalla kohtaa, josta rastiväli alkaa.',
    placeSecond: 'Napsauta nyt kohtaa, johon se päättyy.',
    dragHint: 'Vedä kumpaa tahansa rastia. Reitit seuraavat vetäessä.',
    straightLine: 'Linnuntie',
    bearing: 'Suunta',
    setCourseAround: 'Tee rata tämän rastivälin ympärille',
    setCourseAroundHint:
      'Rastiväli säilytetään, ja valitun sarjan rata tehdään sen ympärille. Sen päät siirtyvät lähimpään kartan kohteeseen 60 metrin säteellä.',
    chooseCentreFirst: 'Valitse ensin kilpailukeskus; rata päättyy sinne.',
  },
  setByHand: {
    title: 'Tee rata itse',
    entry: 'Tee rata itse',
    placeStart: 'Napsauta kartalla lähdön paikkaa. Maali on kilpailukeskuksessa.',
    placeStartTouch: 'Napauta kartalla lähdön paikkaa. Maali on kilpailukeskuksessa.',
    placeNext: control =>
      `Napsauta karttaa lisätäksesi rastin ${control}. Napsauta rastiväliviivaa lisätäksesi rastin siihen tai rastia valitaksesi sen.`,
    placeNextTouch: control =>
      `Napauta karttaa lisätäksesi rastin ${control}. Napauta rastiväliviivaa lisätäksesi rastin siihen tai rastia valitaksesi sen.`,
    snapNote:
      'Rasti siirtyy lähimpään kartan kohteeseen 60 metrin säteellä. Jos sellaista ei ole, se jää paikalleen ja merkitään.',
    selected: stop =>
      typeof stop === 'number'
        ? `Rasti ${stop} on valittu.`
        : `${stop === 'start' ? 'Lähtö' : 'Maali'} on valittu. Vedä sitä siirtääksesi.`,
    selectedControlHint: 'Vedä sitä siirtääksesi tai poista se.',
    deleteKeyHint: 'Delete tai Backspace poistaa sen myös.',
    deleteControl: control => `Poista rasti ${control}`,
    undo: 'Kumoa',
    done: 'Valmis',
    noRulesForClass:
      'Säännöissä ei ole voittoaikaa tälle sarjalle tällä tasolla, joten rataa ei voi tarkistaa.',
    addRefused: 'Rastia ei voitu lisätä siihen.',
    deleteRefused: 'Rastia ei voitu poistaa.',
    finishRefused: 'Maalia ei voitu siirtää siihen.',
    previewTitle: 'Jos sijoitat sen tähän',
    previewFastest: (time, length) => `Nopein ${time}, ${length}`,
    previewLooking: 'Etsitään muita reittejä…',
    previewChoice: (count, difference) =>
      count === 1
        ? `1 muu reitti, ${difference} hitaampi`
        : `${count} muuta reittiä, paras ${difference} hitaampi`,
    previewNoChoice: 'Ei muuta reittiä',
  },
  labels: {
    trainingCourse: 'Harjoitus',
    eventLevels: { national: 'Kansallinen kilpailu', finnishChampionship: 'SM-kilpailu' },
    formats: { long: 'Pitkä matka', middle: 'Keskimatka' },
    trainingStyles: { controlPicking: 'Rastinotto', longLegs: 'Pitkät välit' },
  },
  findings: {
    texts: findingTexts,
    ourCheck: 'oma tarkistuksemme',
    ourCheckNoRoutes: 'oma tarkistuksemme (merkittyjä reittejä ei vielä huomioida)',
  },
  symbols: {
    summary: (count, corrected) => `Karttamerkit (${count}, korjattuja ${corrected})`,
    intro:
      'Miten kukin OCAD-merkki luetaan. Korjaa merkki, jos seura käyttää sitä muuhun, esimerkiksi tiemerkillä piirrettyyn moottoritiehen. Korjaukset tallentuvat tälle kartalle tähän selaimeen.',
    automatic: label => `Automaattinen: ${label}`,
    ignore: 'Älä huomioi tätä merkkiä',
    ignored: 'ei huomioida',
  },
  language: {
    label: 'Kieli',
    ownName: 'Suomi',
    switchTo: 'In English',
  },
  keep: {
    title: 'Säilytä, kun kokeilet uudelleen',
    leg: 'Säilytä tämä rastiväli',
    start: 'Säilytä lähtö',
    control: control => `Säilytä rasti ${control}`,
    hint: '”Kokeile toista rataa” tekee muun radan uudelleen säilyttämiesi ympärille.',
    summary: (controls, legs) =>
      `Säilyttää ${controls === 1 ? '1 rastin' : `${controls} rastia`}` +
      (legs === 0 ? '' : ` ja ${legs === 1 ? '1 rastivälin' : `${legs} rastiväliä`}`) +
      ' uutta rataa kokeiltaessa.',
    forget: 'Unohda ne',
  },
  courseRoutes: {
    title: 'Reitit',
    findAll: 'Etsi reitit kaikille rastiväleille',
    findAllHint:
      'Näyttää, millä rastiväleillä on todellinen reitinvalinta. Pitkät rastivälit vievät hetken.',
    finding: (done, legs) => `Etsitään reittejä: ${done}/${legs} rastiväliä`,
    summary: (withChoice, legs) => `Todellinen reitinvalinta ${withChoice}/${legs} rastivälillä`,
    leg: 'Rastiväli',
    legName: (from, to) => `${from === 'start' ? 'L' : from}–${to === 'finish' ? 'M' : to}`,
    fastest: 'Nopein',
    choice: 'Reitinvalinta',
    alternatives: (count, difference) =>
      count === 1 ? `1 muu, ${difference}` : `${count} muuta, paras ${difference}`,
    none: 'Ei',
    unreachable: 'Ei reittiä',
    findingLeg: '…',
    openLeg: leg => `Näytä rastivälin ${leg} reitit kartalla`,
  },
  landing: {
    pageTitle: 'Ratamestari: suunnistusratojen suunnittelija',
    nav: {
      label: 'Päävalikko',
      how: 'Näin se toimii',
      status: 'Tilanne',
      privacy: 'Yksityisyys',
      sourceCode: 'Lähdekoodi',
      guides: 'Ohjeet',
      openApp: 'Avaa sovellus',
    },
    hero: {
      title: 'Ensimmäinen rata minuuteissa, sääntöjen mukaan.',
      lead: 'Avaa OCAD-karttasi, valitse kilpailukeskus ja sarja. Ratamestari sijoittaa rastit, tarkistaa ne IOF:n ja SSL:n sääntöjä vasten, kirjoittaa rastinmääritteet ja sovittaa kaiken paperille.',
      trySample: 'Kokeile esimerkkikartalla',
      openOwn: 'Avaa oma karttasi',
      checkOwn: 'Tarkista tekemäsi rata',
      privacy: 'Toimii selaimessasi. Karttasi ei koskaan lähde koneeltasi.',
    },
    demo: {
      label:
        'Animaatio: kartta avautuu, kilpailukeskus valitaan, mahdolliset rastipaikat ilmestyvät, hyvät tekniset alueet löytyvät, niiden kautta suunniteltu rata piirtyy rastiväli kerrallaan ja rastinmääritteet kirjoitetaan.',
      steps: [
        'Kartta avattu',
        'Kilpailukeskus',
        'Rastipaikat',
        'Tekniset alueet',
        'Rataa tehdään',
        'Määritteet ja paperi',
        'Valmis tulostettavaksi',
      ],
      mapCaption: 'Luettu selaimessasi, mitään ei lähetetty',
      centreCaption: 'Sinun valitsemasi',
      sitesCaption: count => `${count} mahdollista rastipaikkaa kartan kohteissa`,
      areasCaption: (count, minutes) =>
        `${count} ${count === 1 ? 'tekninen alue' : 'teknistä aluetta'} löytyi, ${minutes} min radasta suunniteltu niille`,
      courseCaption: (length, controls) =>
        `${length} tähän mennessä, ${controls} ${controls === 1 ? 'rasti' : 'rastia'} sijoitettu`,
      descriptionsCaption: 'IOF-rastinmääritteet kirjoitettu, rata sovitettu paperille',
      doneCaption: (length, climb) => `${length}, nousua ${climb}, valmis tulostettavaksi`,
      credit:
        'Ratamoottorin todellinen ajo esimerkkikartalla: Leirikangas, Hamina. © Vehkalahden Veikot.',
      play: 'Toista esittely',
      pause: 'Keskeytä esittely',
    },
    how: {
      title: 'Neljä vaihetta yhdellä näkymällä.',
      steps: [
        {
          title: 'Avaa karttasi',
          text: 'Valitse OCAD-tiedosto. Se luetaan selaimessa ja näytetään tulostettavana sivuna.',
        },
        {
          title: 'Valitse kilpailukeskus',
          text: 'Napsauta kilpailukeskuksen paikkaa. Maali tulee siihen ja lähtö lähelle.',
        },
        {
          title: 'Valitse sarja',
          text: 'Kilpailun taso, matka ja sarja. Ratamestari löytää hyvät tekniset alueet, suunnittelee radan niiden kautta ja näyttää sen, kun se on valmis.',
        },
        {
          title: 'Tarkista ja tulosta',
          text: 'Katso reitit, siirrä rasteja, korjaa mitä säännöt huomauttavat ja tallenna tulostettava PDF ja IOF XML.',
        },
      ],
    },
    checks: {
      title: 'Jokainen tarkistus kertoo sääntönsä.',
      text: 'Etäisyydet, reitit ja nousut mitataan kartasta, ei arvata. Jokainen varoitus kertoo sen taustalla olevan IOF:n tai SSL:n säännön, joten voit tarkistaa sen. Maastossa käynti ja viimeinen sana jäävät sinulle ja valvojallesi.',
      exampleLabel: 'Esimerkki sääntötarkistuksista',
      exampleTitle: '2 tarkistettavaa asiaa',
      examples: [
        {
          severity: 'error',
          text: 'Rastit 7 ja 8 ovat samannäköisiä ja 26 metrin päässä toisistaan. Väliä pitää olla vähintään 30 m.',
          basis: 'Lajisäännöt 2026 11.41',
        },
        {
          severity: 'note',
          text: 'Rasti 4 on kukkulan laella, mikä on helppo tälle tasolle.',
          basis: 'Oma tulkintamme vaikeustasojen ohjeista',
        },
      ],
      error: 'Virhe',
      note: 'Huomio',
      fix: 'Korjaa',
    },
    status: {
      title: 'Mikä toimii ja mikä ei vielä.',
      text: 'Ratamestari sai alkunsa hackathon-prototyyppinä lokakuussa 2026. Käytä sitä ratojen luonnosteluun, älä tarkistusten ohittamiseen.',
      columns: [
        {
          title: 'Toimii nyt',
          items: [
            'OCAD-kartat luettuna selaimessa',
            'Pitkä matka ja keskimatka SSL:n sarjoille',
            'Radat suunnitellaan kartan parhaiden teknisten alueiden kautta, aikaa jokaiselle osalle',
            'Rastit todellisissa kartan kohteissa, ei koskaan liian tiheässä',
            'Sääntötarkistukset lähteineen ja Korjaa-painikkeineen',
            'OCADissa tai Purple Penissä tehdyn radan tarkistus',
            'Kaikkien rastivälien reitit nopeimmasta hitaimpaan',
            'Rastivälin suunnittelu itse',
            'Radan tekeminen itse rasti kerrallaan',
            'Rastien siirtäminen vetämällä, säännöt tarkistetaan uudelleen',
            'Mieluisten rastien ja rastivälien säilyttäminen uutta rataa kokeiltaessa',
            'Kumoa, myös avustajan tekemille muutoksille',
            'Haun pysäytys parhaan radan säilyttäen',
            'IOF-rastinmääritteet kartalla',
            'Rastinumerot rastiväliviivojen ulkopuolella',
            'Automaattinen sovitus A4- tai A3-paperille',
            'Tulostusalueen siirtäminen käsin',
            'Tulostettava PDF ja IOF XML 3.0',
            'Puhelimet ja tabletit',
            'Vapaaehtoinen avustaja omalla Claude API -avaimella: ratojen teko, muokkaus ja parannus omin sanoin',
            'Suomeksi',
          ],
        },
        {
          title: 'Tulossa seuraavaksi',
          items: [
            'Paperin sijoittaminen radan suunnitelman mukaan',
            'Kilpailukeskusehdotukset kartalta',
            'Useita sarjoja rinnakkain',
            'Avoimet radat, finaalit ja karsinnat',
            'OpenOrienteering Mapper -tiedostot',
          ],
        },
        {
          title: 'Myöhemmin',
          items: [
            'Sprintti',
            'Kartat PNG- tai PDF-kuvina',
            'Viestien hajonnat',
            'Kaikkien kilpailun ratojen suunnittelu yhdessä',
            'Avustaja ilman omaa avainta',
          ],
        },
      ],
    },
    privacy: {
      title: 'Karttasi pysyy sinulla.',
      paragraphs: [
        'Palvelinta ei ole. Kartta luetaan, reititetään ja tulostetaan selaimessasi, eikä mitään lähetetä. Lähdekoodi on julkinen, joten kuka tahansa voi tarkistaa sen.',
        'Avustaja on vapaaehtoinen, ja kaikki toimii ilman sitä. Omalla Claude API -avaimellasi voit pyytää omin sanoin, esimerkiksi ”tee rastivälistä 5 vaikeampi”. Se saa vain tekstiä ja lukuja, ei koskaan karttaa tai koordinaatteja.',
      ],
      exampleLabel: 'Esimerkki keskustelusta avustajan kanssa',
      exampleQuestion: 'Tee rastivälistä 5 vaikeampi, siinä vain juostaan polkua pitkin.',
      exampleAnswer:
        'Siirsin rastin 5 polun mutkasta 180 metriä itään notkoon. Nyt rastivälillä on valinta: polkua pitkin kiertäen tai suoraan mäen yli 35 metrin nousulla. Rastien välit ja radan pituus täyttävät yhä SSL:n säännöt.',
    },
    credits: {
      madeBy: 'Tekijä',
      author: 'Pouju',
      about:
        'Ratamestari on avointa lähdekoodia, ja ratamestarien palaute on erittäin tervetullutta.',
      github: 'GitHub',
      feedback: 'Lähetä palautetta',
      items: [
        {
          title: 'OCAD-tiedostojen luku',
          text: 'ocad2geojson, tekijä Per Liedman',
          link: 'ocad2geojson',
        },
        {
          title: 'Esimerkkikartta',
          text: 'Leirikangas, Hamina, © Vehkalahden Veikot, mukana vain Ratamestarin kokeilemista varten',
          link: null,
        },
        { title: 'Säännöt', text: 'IOF:n ja Suomen Suunnistusliiton sääntöasiakirjat', link: null },
        {
          title: 'Kävijämäärät',
          text: 'Umami Cloud laskee käynnit ja muutamia toimintoja, kuten radan tekemisen, jotta näemme, käytetäänkö sovellusta. Se ei käytä evästeitä, ei kerää henkilötietoja eikä muodosta sinusta profiilia. Karttasi ja ratasi eivät ole koskaan osa sitä.',
          link: null,
        },
        {
          title: 'Tehty käyttäen',
          text: 'OpenLayers, React, Vite, pdf-lib, ja avustajassa Claude',
          link: null,
        },
      ],
    },
    footer: {
      by: 'Ratamestarin tekijä',
      licence: 'AGPL-3.0-or-later',
      sourceCode: 'Lähdekoodi',
      version: version => `Versio ${version}`,
    },
  },
  guides: {
    pageTitle: 'Ohjeet · Ratamestari',
    title: 'Näin käytät Ratamestaria',
    lead: 'Lyhyitä esittelyjä siitä, mitä työtilassa voi tehdä, esimerkkikartalla. Osa on yhden napautuksen päässä ja helppo ohittaa.',
    contents: 'Ohjeet',
    trySample: 'Kokeile esimerkkikartalla',
    backHome: 'Ratamestarin etusivu',
    credit:
      'Kartta © Vehkalahden Veikot. Reitit ja rastit on tallennettu ratamoottorin ajosta esimerkkikartalla.',
    setCourse: {
      title: 'Tee rata',
      intro: 'Avaa karttasi tai esimerkkikartta ja valitse paneelista sarja ja matka.',
      steps: [
        'Napsauta kilpailukeskusta kartalla. Maali tulee siihen ja lähtö lähelle.',
        'Paina Tee rata. Paneeli näyttää, mitä ratamoottori tekee; Pysäytä säilyttää parhaan tähänastisen radan.',
        'Rata ilmestyy rastinmääritteineen ja sääntöjä vasten tarkistettuna.',
      ],
      label:
        'Animaatio: kilpailukeskusta napsautetaan, Tee rata -painiketta painetaan ja rata ilmestyy.',
    },
    legRoutes: {
      title: 'Katso rastivälin reitinvalinnat',
      intro: 'Jokaisen rastivälin reitit voi katsoa; ne lasketaan kartan merkeistä.',
      steps: [
        'Napauta kartalla rastiväliviivaa tai rastia.',
        'Nopein reitti piirretään vihreällä, muut todelliset reitinvalinnat sinisellä ja punaisella.',
        'Paneeli vertaa pituutta ja aikaa. Nuolilla siirryt seuraavaan rastiväliin.',
      ],
      label: 'Animaatio: rastiväliä napautetaan ja sen reitit ilmestyvät kartalle ja paneeliin.',
    },
    courseRoutes: {
      title: 'Etsi reitinvalinnat kaikilta rastiväleiltä',
      intro: 'Näe yhdellä silmäyksellä, millä rastiväleillä on todellinen reitinvalinta.',
      steps: [
        'Kun rata on kartalla, paina paneelista Etsi reitit kaikille rastiväleille.',
        'Kunkin rastivälin reitit piirtyvät sitä mukaa kuin ne löytyvät.',
        'Napauta riviä tai rastiväliä kartalla. Sen reitit aukeavat listan yläpuolelle, ja lista pysyy.',
      ],
      tip: 'Tasot › Kaikkien rastivälien reitit kytkee piirron päälle ja pois.',
      label: 'Animaatio: reitit etsitään jokaiselle rastivälille ja listataan paneeliin.',
    },
    keep: {
      title: 'Säilytä mieluisat, kokeile uudelleen',
      intro: 'Pidätkö osasta rataa? Säilytä se ja anna ratamoottorin tehdä muu uudelleen.',
      steps: [
        'Napauta rastiväliä ja paina Säilytä tämä rastiväli tai säilytä jokin sen rasteista.',
        'Säilytetyt rastit ja rastivälit saavat kartalle riippulukon.',
        'Paina Kokeile toista rataa. Säilytetyt pysyvät paikallaan ja järjestyksessä, ja muu on uutta.',
      ],
      label:
        'Animaatio: rastiväli säilytetään, Kokeile toista rataa -painiketta painetaan ja uusi rata tehdään säilytetyn rastivälin ympärille.',
    },
    drag: {
      title: 'Siirrä rastia',
      intro: 'Voit siirtää mitä tahansa rastia, lähtöä tai maalia käsin.',
      steps: [
        'Paina rastia ja vedä sitä. Kosketusnäytöllä napauta ensin sen rastiväliä.',
        'Päästä irti: rasti siirtyy lähimpään kartan kohteeseen 60 metrin säteellä.',
        'Pituus, rastinmääritteet ja sääntötarkistukset päivittyvät heti.',
      ],
      label: 'Animaatio: rastia vedetään uuteen paikkaan ja säännöt tarkistetaan uudelleen.',
    },
    setByHand: {
      title: 'Tee rata itse',
      intro: 'Sijoita jokainen rasti käsin ja anna Ratamestarin tarkistaa, kuvata ja tulostaa se.',
      steps: [
        'Paina paneelista Tee rata itse tai kartalta Muokkaa rasteja.',
        'Napsauta lähtö ja sitten jokainen rasti järjestyksessä. Maali on kilpailukeskuksessa.',
        'Napsauta rastia valitaksesi sen ja paina Delete poistaaksesi sen.',
        'Kumoa tai Ctrl+Z tuo sen takaisin.',
      ],
      label:
        'Animaatio: lähtö ja kolme rastia sijoitetaan käsin, yksi poistetaan ja poisto kumotaan.',
    },
    planLeg: {
      title: 'Suunnittele yksittäinen rastiväli',
      intro: 'Kokeile rastiväliä missä tahansa kartalla ennen kuin se on osa rataa.',
      steps: [
        'Paina karttatyökaluista Suunnittele rastiväli.',
        'Napsauta, mistä rastiväli alkaa, ja sitten, mihin se päättyy.',
        'Vertaa reittejä. Vedä kumpaa tahansa päätä, ja reitit seuraavat.',
        'Paina Tee rata tämän rastivälin ympärille: rastiväli säilytetään ja rata tehdään sen ympärille.',
      ],
      label:
        'Animaatio: kaksi pistettä napsautetaan, niiden väliset reitit ilmestyvät ja rata tehdään rastivälin ympärille.',
    },
    assistant: {
      title: 'Kysy avustajalta',
      intro: 'Vapaaehtoinen: ota se käyttöön asetuksista omalla Claude API -avaimellasi.',
      steps: [
        'Kirjoita omin sanoin, mitä haluat.',
        'Ratamoottori tekee muutoksen. Avustaja lukee vain sanoja ja lukuja, ei koskaan karttaa.',
        'Se kertoo, mitä muuttui. Pyydä kumoamaan, jos muutat mielesi.',
      ],
      question: (control, direction) => `Siirrä rastia ${control} vähän ${direction}`,
      answer: (control, direction) =>
        `Tehty. Rasti ${control} on nyt siirretty ${direction}. Radan pituus ja sääntötarkistukset on päivitetty paneeliin.`,
      directions: {
        N: 'pohjoiseen',
        NE: 'koilliseen',
        E: 'itään',
        SE: 'kaakkoon',
        S: 'etelään',
        SW: 'lounaaseen',
        W: 'länteen',
        NW: 'luoteeseen',
      },
      label: 'Animaatio: avustajaa pyydetään siirtämään rastia, ja rasti siirtyy kartalla.',
    },
    tips: {
      title: 'Lisää löydettävää',
      items: [
        {
          title: 'Kulkukelpoisuus',
          text: 'Tasot › Kulkukelpoisuus näyttää, kuinka nopeaa kartan kukin osa on juosta. Kaikki reitit perustuvat siihen.',
        },
        {
          title: 'Mahdolliset rastipaikat',
          text: 'Tasot › Mahdolliset rastipaikat näyttää kaikki paikat, joita ratamoottori voisi käyttää, vaikeuden mukaan värjättyinä.',
        },
        {
          title: 'Korjaa-painikkeet',
          text: 'Yhteen rastiin liittyvällä sääntöongelmalla on Korjaa-painike, joka siirtää rastin parempaan paikkaan.',
        },
        {
          title: 'Tulostusalue ja paperi',
          text: 'Kartan alla olevista tulostusasetuksista vaihdat paperin, mittakaavan ja suunnan tai voit vetää tulostusaluetta.',
        },
        {
          title: 'Tarkista tekemäsi rata',
          text: 'Avaa OCADista tai Purple Penistä radan IOF XML -tiedosto. Se tarkistetaan sarjansa sääntöjä vasten.',
        },
        {
          title: 'Karttamerkit',
          text: 'Asetukset › Karttamerkit näyttää, miten kukin OCAD-merkki luetaan. Korjaa merkki, jos seurasi käyttää sitä toisin.',
        },
        {
          title: 'Toinen rata',
          text: '”Kokeile toista rataa” tekee uuden radan samoilla asetuksilla.',
        },
        {
          title: 'Vienti',
          text: '”Lataa PDF” antaa tulostettavan sivun ja rastinmääritesivun. IOF XML aukeaa OCADissa, Condesissa ja Purple Penissä.',
        },
      ],
    },
  },
  scoreBreakdown: {
    summary: total => `Laatupisteet ${total} (pienempi on parempi)`,
    terms: {
      timeErrorPerPercent: 'Voittoaika',
      timeOutsideRangePerPercent: 'Aikahaarukan ulkopuolella',
      spacing: 'Rastien välit',
      acuteAngleWarning: 'Terävät kulmat',
      acuteAngleNote: 'Alle 60°:n kulmat',
      difficultyOutsideRange: 'Vaikeus',
      courseLineCrossing: 'Risteävät viivat',
      courseLineThroughControl: 'Viivat ympyröiden läpi',
      finalLegPerPercentOverLimit: 'Viimeinen rastiväli',
      courseLineOutsideMap: 'Viivat kartan ulkopuolella',
      courseLineOverDescriptions: 'Viivat määritteiden alla',
      overlappingCircles: 'Päällekkäiset ympyrät',
      areaQuality: 'Maaston laatu',
      routeChoicePerKeyLeg: 'Reitinvalinta',
      reversals: 'Paluut taaksepäin',
      ring: 'Rengasmaisuus',
      legLengths: 'Rastivälien pituusjakauma',
      alternation: 'Yksitoikkoiset rastivälit',
      directionChanges: 'Suunnanmuutokset',
      firstLeg: 'Ensimmäinen rastiväli',
      spread: 'Maaston käyttö',
      parallelLegs: 'Rinnakkaiset rastivälit',
      closeness: 'Ohitukset läheltä uudelleen',
      crowding: 'Tiheät rastit',
      legCount: 'Rastivälien määrä',
    },
  },
  units: {
    seconds: value => `${value} s`,
  },
}
