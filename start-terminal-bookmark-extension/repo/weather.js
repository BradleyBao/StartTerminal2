return (async () => {
    // [!!] 默认值已修改为上海 [!!]
    let lat = 31.2304; // 默认：上海
    let lon = 121.4737;
    let cityName = "Shanghai (Default)";

    const cityQuery = args.join(' ');

    try {
        if (cityQuery) {
            // 1. 提供了城市，先进行地理编码
            st_api.writeLine(`Geocoding "${cityQuery}"...`);
            const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityQuery)}&count=1`;
            const geoResponse = await fetch(geoUrl);
            const geoData = await geoResponse.json();

            if (geoData && geoData.results && geoData.results.length > 0) {
                const loc = geoData.results[0];
                lat = loc.latitude;
                lon = loc.longitude;
                cityName = loc.name + (loc.admin1 ? `, ${loc.admin1}` : '') + (loc.country_code ? `, ${loc.country_code}` : '');
            } else {
                st_api.writeHtml(`<span class="term-error">City not found: ${cityQuery}</span>`);
                return;
            }
        }
        
        // 2. 获取天气
        st_api.writeLine(`Fetching weather for ${cityName}...`);
        const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`;
        const weatherResponse = await fetch(weatherUrl);
        const weatherData = await weatherResponse.json();

        if (weatherData && weatherData.current_weather) {
            const w = weatherData.current_weather;
            st_api.writeLine(`Temp: ${w.temperature}°C (Wind: ${w.windspeed} km/h)`);
        } else {
            st_api.writeHtml('<span class="term-error">Could not fetch weather data.</span>');
        }

    } catch(e) {
        st_api.writeHtml(`<span class="term-error">${e.message}</span>`);
        st_api.writeHtml(`<span class="term-error">Did you 'sudo apt install weather' to grant host permissions?</span>`);
    }
})();
