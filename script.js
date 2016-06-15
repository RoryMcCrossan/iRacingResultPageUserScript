// ==UserScript==
// @name         iRacing Laptime Chart
// @namespace    http://rorymccrossan.co.uk/
// @version      1.2
// @description  Add a lap time chart to the lap time screen
// @author       Rory McCrossan
// @match        http://members.iracing.com/membersite/member/eventresult_laps.jsp*
// @grant        none
// @require http://code.jquery.com/jquery-latest.js
// @require http://code.highcharts.com/highcharts.js
// ==/UserScript==

// TODO: discount cumulative if 1+ laptimes are missing.
// TODO: exclude single lap from delta if laptime is missing
// TODO: scale delta chart

(function($) {
    var _dataset = {
        xData: [],
        yLaptimes: [],
        yValidLaptimes: [],
        yDelta: [],
        yCumulativeDelta: [],
        hasLapInconsistency: false,
        averageLapTimeSeconds: 0,
        totalRaceTime: 0
    };

    var _globals = {};
    _globals.$container = $('body');
    _globals.isTeamEvent = $('.laps_table:first tr').not(':eq(0)').first().find('td').length == 3;
    _globals.charts = {};
    _globals.sessionCache = {};
    _globals.sessionId = '';
    _globals.currentUsername = '';
    _globals.$comparisonSelect = null;
    _globals.$lapChart = null;
    _globals.$deltaChart = null;

    initUI();

    // allow for AJAX retrieval of laptimes before processing charts
    setTimeout(function() {
        buildDataset();
        createLaptimeChart();
        createDeltaChart();
        updateUI();
    }, 500);

    function initUI() {    
        $('<style />', {
            text: "#laptimes .center { text-align: 'left'; margin: 10px; }" + 
            "body, html { height: 100% }" + 
            "#laptimes > div > div { height: 45px !important; margin-bottom: 7px !important; }" + 
            "#laptimes > div > div > a { height: 100%; display: block; background: transparent url('http://members.iracing.com/member_images/aboveheader/small-header-logo.png') 60px 9px no-repeat; }" + 
            "#laptimes > div > div img { display: none; }" + 
            "#laptimes .avgs td { padding: 4px; }" +
            ".laps_table tr:first-child { height: 18px !important; }" + 
            ".laps_table th { padding-top: 0; }" + 
            ".laps_table td b { font-size: 7pt; }" + 
            ".laps_table .inconsistency-warning td { color: #C00; font-weight: bold; }" + 
            ".row-hover-highlight { background-color: #7cb5ec; }" +
            ".row-hover-highlight td, .row-hover-highlight a { color: #FFF !important; }" + 
            "#tab-container { min-width: 400px; min-height: 400px; position: fixed; top: 10px; left: 415px; right: 20px; bottom: 20px; }" +
            "#tabs { list-style-type: none; margin: 0; padding: 0; position: absolute; height: 25px; top: 0; z-index: 10; }" +
            "#tabs li { display: inline-block; border: 1px solid #CCC; height: 100%; background-color: #EDEDED; margin-right: 2px; }" + 
            "#tabs li.active { background-color: #FFF; border-bottom-color: #FFF; }" + 
            "#tabs li a { padding: 0 10px; line-height: 25px; font-weight: bold; color: #646464; font-size: 7pt; }" + 
            ".tab { min-width: 400px; min-height: 400px; border: 1px solid #CCC; box-shadow: 5px 5px 2px #EFEFEF; display: none; position: absolute; top: 26px; right: 0; bottom: 0; left: 0; }" + 
            ".tab.active { display: block; }" + 
            ".tab .chart { height: 100%; }" + 
            ".chart-options { width: 200px; height: 35px; z-index: 999; }" + 
            "#scale-container { position: absolute; top: 10px; right: 10px; text-align: right; }" + 
            "#comparison-container { position: fixed; top: 10px; right: 20px; text-align: right; }" + 
            ".no-delta-data {  position: absolute; width: 380px; top: 50px; color: #C00; font-weight: bold; left: 50%; margin-left: -190px; z-index: 10; }"
        }).appendTo('head');

        _globals.$container.append('<div id="tab-container"><ul id="tabs"><li><a href="#laptimes-tab">Laptimes</a></li><li><a href="#delta-tab">Delta</a></li></ul><div class="tab" id="laptimes-tab"><div class="chart"></div></div><div class="tab" id="delta-tab"><div class="chart"></div></div></div>');
        $('#tabs li:first, .tab:first').addClass('active');
        $('#tabs a').click(function(e) {
            e.preventDefault();
            $('.active').removeClass('active');
            $(this).closest('li').add($(this).attr('href')).addClass('active');
            _helperFuncs.setChartSizes();
        });

        var resizeTimer;
        $(window).resize(function() {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(function() {
                _helperFuncs.setChartSizes();
            }, 100);
        });
    }

    function buildDataset() {
        $('.laps_table tr').not(':eq(0)').each(function() {
            var lapTimeTdIndex = _globals.isTeamEvent ? 1 : 2;
            var lapNumber = parseInt($(this).find('td:eq(0)').text(), 10);
            var lapTime = _helperFuncs.toSeconds($(this).find('td:eq(' + lapTimeTdIndex + ')').text());
            if (lapNumber > 0) {
                _dataset.xData.push(lapNumber);
                _dataset.yLaptimes.push(lapTime);
                if (lapTime != null)
                    _dataset.yValidLaptimes.push(lapTime);
            }
        });
        
        _dataset.hasLapInconsistency = _dataset.yValidLaptimes.length != _dataset.yLaptimes.length;
        _dataset.totalRaceTime = _dataset.yValidLaptimes.reduce(function(a, b) {
            return a + b;
        });
        _dataset.averageLapTimeSeconds = _dataset.totalRaceTime / _dataset.yValidLaptimes.length;

        // set localStorage for quick retrieval to calculate delta
        _globals.sessionId = $.trim($('#laptimes table:first div:eq(3)').text().split(':')[1]);
        _globals.currentUsername = $('.stats_table_link:first').text();
        _globals.sessionCache = JSON.parse(localStorage.getItem(_globals.sessionId) || "{}");
        if (!_globals.sessionCache.hasOwnProperty(_globals.currentUsername)) {
            var userSessionData = {
                yLaptimes: _dataset.yLaptimes,
                hasLapInconsistency: _dataset.hasLapInconsistency,
                averageLapTimeSeconds: _dataset.averageLapTimeSeconds    
            }
            _globals.sessionCache[_globals.currentUsername] = userSessionData;
            localStorage.setItem(_globals.sessionId, JSON.stringify(_globals.sessionCache));
        }
    }

    function createLaptimeChart() {
        _globals.$lapChart = $('#laptimes-tab .chart');
        _globals.$lapChart.highcharts({
            title: {
                text: 'Lap Times'
            },
            xAxis: {
                categories: _dataset.xData,
                title: {
                    text: 'Lap'
                },
                tickInterval: 1,
                tickLength: 5,
                tickColor: '#E8E8E8',
                lineColor: '#E8E8E8'
            },
            yAxis: [{
                title: {
                    text: 'Laptime (seconds)'
                },
                tickInterval: 1,
                gridLineColor: '#F7F7F7'
            }],
            tooltip: {
                shared: true,
                formatter: function() {
                    var xPos = this.x;
                    $('.laps_table:first tr').find('td:eq(0)').filter(function() {
                        return parseInt($(this).text(), 10) == xPos;
                    }).closest('tr').addClass('row-hover-highlight').siblings().removeClass('row-hover-highlight');
                    
                    var tooltipText = '<b>Lap:</b> ' + xPos + '<br /><b>' + _globals.currentUsername + ':</b> ' + _helperFuncs.toMinutes(this.points[0].y);                    
                    if (this.points.length > 1)
                        tooltipText += '<br /><b>' + _globals.$comparisonSelect.val() + ':</b> ' + _helperFuncs.toMinutes(this.points[1].y);                    
                    return tooltipText;
                },
                zIndex: 10000
            },
            series: [{
                name: _globals.currentUsername,
                data: _dataset.yLaptimes,
                zIndex: 5,
                color: '#7cb5ec',
                marker: {
                    symbol: 'diamond'
                }                    
            }]
        });
        _globals.charts.laptimes = _globals.$lapChart.highcharts();

        // current user plotline
        _globals.charts.laptimes.yAxis[0].addPlotLine({
            value: _dataset.averageLapTimeSeconds,
            color: '#7CB5EC',
            dashStyle: 'ShortDash',
            width: 1,
            zIndex: 3
        });

        // add hover states to lap table
        $('.laps_table:first tr:gt(1)').hover(function() {
            $(this).addClass('row-hover-highlight').siblings().removeClass('row-hover-highlight');
            /*
            var pointIndex = $(this).index() - (_globals.isTeamEvent ? 1 : 2);            
            for (var n = 0; n < _globals.charts.laptimes.series.length; n++) {
                for (var i = 0; i < _globals.charts.laptimes.series[n].data.length; i++) {
                    var dataPoint = _globals.charts.laptimes.series[n].data[i];
                    if (i == pointIndex) {
                        dataPoint.setState('hover');
                        _globals.charts.laptimes.tooltip.refresh(_globals.charts.laptimes.series[n].data[i]);
                    }
                    else {
                        dataPoint.setState();
                    }
                }
            }
            */
        }, function() {
            $('.row-hover-highlight').removeClass('row-hover-highlight');
            /*
            for (var n = 0; n < _globals.charts.laptimes.series.length; n++) {
                for (var i = 0; i < _globals.charts.laptimes.series[n].length; i++) {
                    _globals.charts.laptimes.series[n].data[i].setState();
                }
            }
            */
        });        

        // scaling options
        var $scaleContainer = $('<div />', { id: 'scale-container', class: 'chart-options' }).appendTo(_globals.$lapChart);
        $('<label />', { text: 'Scale: ' }).appendTo($scaleContainer);

        var $scaleSelect = $('<select />', { id: 'scale-select' }).appendTo($scaleContainer);
        $('<option />', { value: 'all', text: 'Show all' }).appendTo($scaleSelect);
        $('<option />', { value: 'max', text: 'To upper' }).appendTo($scaleSelect);
        $('<option />', { value: 'min', text: 'To lower' }).appendTo($scaleSelect);
        $('<option />', { value: 'avg', text: 'To average' }).appendTo($scaleSelect);
        $scaleSelect.val(localStorage.getItem('scale') || 'all');
        $scaleSelect.change(function() {
            _helperFuncs.setScale($(this).val());
        });
        _helperFuncs.setScale(localStorage.getItem('scale') || 'all'); // set on load
    }

    function createDeltaChart() {
        _globals.$deltaChart = $('#delta-tab .chart');
        _globals.$deltaChart.highcharts({
            title: {
                text: 'Lap Delta'
            },
            xAxis: {
                categories: _dataset.xData,
                title: {
                    text: 'Lap'
                },
                tickInterval: 1,
                tickLength: 5,
                tickColor: '#E8E8E8',
                lineColor: '#E8E8E8'
            },
            yAxis: [{
                title: {
                    text: 'Delta (seconds)'
                },
                tickInterval: 1,
                gridLineColor: '#F7F7F7',
                plotLines: [{
                    value: 0,
                    color: '#E0E0E0',
                    width: 1,
                    zIndex: 3
                }]
            }],
            tooltip: {
                shared: true,
                formatter: function() {
                    var xPos = this.x;                    
                    $('.laps_table:first tr').find('td:eq(0)').filter(function() {
                        return parseInt($(this).text(), 10) == xPos;
                    }).closest('tr').addClass('row-hover-highlight').siblings().removeClass('row-hover-highlight');                    
                    
                    var laptime = _globals.sessionCache[_globals.currentUsername].yLaptimes[xPos - 1];
                    var comparisonLaptime = _globals.sessionCache[_globals.$comparisonSelect.val()].yLaptimes[xPos - 1];
                    var tooltipText = '<b>Lap:</b> ' + xPos + '<br />';                    
                    if (this.points.length > 1) 
                        tooltipText += '<b>Delta:</b> ' + _helperFuncs.toMinutes(this.points[1].y, true) + '<br />';                    
                    
                    tooltipText += '<b>' + _globals.currentUsername + ':</b> ' + (laptime != null ? _helperFuncs.toMinutes(laptime) : '---') + '<br />' +
                        '<b>' + _globals.$comparisonSelect.val() + ':</b> ' + (comparisonLaptime != null ? _helperFuncs.toMinutes(comparisonLaptime) : '---'); 
                    
                    if (laptime != null && comparisonLaptime != null)
                        tooltipText += ' (' + _helperFuncs.toMinutes(this.points[0].y, true) + ')';                    
                    
                    return tooltipText;
                }
            }
        });
        _globals.charts.delta = _globals.$deltaChart.highcharts();
    }
    
    function updateUI() {
        var inconsitencyMarker = _dataset.hasLapInconsistency ? '*' : '';

        // average lap time in tables
        var $avgTable = $('<table />').addClass('center laps_table marginbottom20 avgs').appendTo('#laptimes > div');
        $avgTable.append('<tr><td><b>Total race time:</b></td><td>' + _helperFuncs.toMinutes(_dataset.totalRaceTime) + inconsitencyMarker + '</td></tr>');
        $avgTable.append('<tr class="back_dcdcdc"><td><b>Average lap:</b></td><td>' + _helperFuncs.toMinutes(_dataset.averageLapTimeSeconds) + inconsitencyMarker + '</td></tr>');
        
        if (_dataset.hasLapInconsistency) 
            $avgTable.append('<tr class="inconsistency-warning"><td colspan="2">Warning: the above values may be incorrect<br />due to laptime discontinuity</td></tr>');
        
        // comparison options
        var $deltaContainer = $('<div />', { id: 'comparison-container', class: 'chart-options' }).appendTo(_globals.$container);
        $('<label />', { text: 'Compare to: ' }).appendTo($deltaContainer);

        _globals.$comparisonSelect = $('<select />', { id: 'comparison-select' }).appendTo($deltaContainer);
        $.each(_globals.sessionCache, function(username) {
            if (username == _globals.currentUsername)
                return;
            $('<option />', { text: username }).appendTo(_globals.$comparisonSelect);
        });
        _globals.$comparisonSelect.change(function() {
            _helperFuncs.setComparison(_globals.$comparisonSelect.val());
        });
        if (_globals.$comparisonSelect.is(':empty')) {
            $deltaContainer.hide();
            $('<div class="no-delta-data">There is no data from other drivers in this session from which to form the lap delta.<br /><br />View another drivers lap times to populate this chart.</div>').appendTo(_globals.$deltaChart);
        }
        else {
            _helperFuncs.setComparison(_globals.$comparisonSelect.val());
        }
    }

    var _helperFuncs = {
        toSeconds: function(str) {
            var pieces = str.split(":");
            var result = Number(pieces[0]) * 60 + Number(pieces[1]);
            var fixedResult = result.toFixed(3);
            return isNaN(fixedResult) ? null : parseFloat(fixedResult);
        },
        toMinutes: function(time, forceSign) {
            var isNegative = time < 0;
            time = Math.abs(time.toFixed(3));
            var splitTime = (time + '').split('.');
            var seconds = splitTime[0] || 0;
            var milliseconds = splitTime[1] || 0;

            var date = new Date(null);
            date.setSeconds(seconds);

            var output = _helperFuncs.padTrailing(milliseconds, 3); // ms
            output = (date.getUTCMinutes() > 0 ? _helperFuncs.padLeading(date.getUTCSeconds(), 2) : date.getUTCSeconds()) + '.' + output; // seconds

            if (date.getUTCMinutes() > 0 || date.getUTCHours() > 0)
                output = (date.getUTCHours() > 0 ? _helperFuncs.padLeading(date.getUTCMinutes(), 2) : date.getUTCMinutes()) + ':' + output; // minutes

            if (date.getUTCHours() > 0)
                output = _helperFuncs.padLeading(date.getUTCHours(), 2) + ':' + output; // hours

            if (forceSign)
                output = (isNegative ? '-' : '+') + output;

            return output;
        },
        toDecimalPlaces: function(value, decimalPlaces) {
            var product = Math.pow(10, decimalPlaces);
            return Math.round(value * product) / product;
        },
        removeElementsWithValue: function(arr, val) {
            var arrCopy = arr;
            var i = arrCopy.length;
            while (i--) {
                if (arrCopy[i] === val) {
                    arrCopy.splice(i, 1);
                }
            }
            return arrCopy;
        },
        setChartSizes: function() {
            var $laptimesChartContainer = $('#laptimes-tab .chart');
            _globals.charts.laptimes.setSize($laptimesChartContainer.width(), $laptimesChartContainer.height(), false);

            var $deltaChartContainer = $('#delta-tab .chart');
            _globals.charts.delta.setSize($deltaChartContainer.width(), $deltaChartContainer.height(), false);
        },
        padLeading: function(value, finalLength, char) {
            var char = char || "0";
            var padding = new Array(finalLength + 1).join(char);
            return (padding + value).substr(-finalLength);
        },
        padTrailing: function(value, finalLength, char) {
            var char = char || "0";
            var padding = new Array(finalLength + 1).join(char);
            return (value + padding).substr(0, finalLength);
        },
        setScale: function(scaleSetting) {
            localStorage.setItem('scale', scaleSetting);
            var maxLaptime = Math.max.apply(null, _dataset.yLaptimes);
            var minValidLaptime = Math.min.apply(null, _dataset.yValidLaptimes);
            var extents = [ 0, 0 ];

            // TODO: include visible rival laptimes
            switch (scaleSetting) {
                case 'all': // full extents
                    extents = [ Math.max(minValidLaptime - 3, 0), maxLaptime + 3 ];
                    break;
                case 'max': // average up to max
                    extents = [ Math.max(_dataset.averageLapTimeSeconds - 5, 0), maxLaptime + 3 ];
                    break;
                case 'min': // average down to min valid
                    extents = [ minValidLaptime - 3, Math.max(_dataset.averageLapTimeSeconds + 5, 0) ];
                    break;
                case 'avg': // average - 10 to average + 10
                    extents = [ _dataset.averageLapTimeSeconds - 10, _dataset.averageLapTimeSeconds + 10 ];
                    break;
            }
            
            _globals.charts.laptimes.yAxis[0].setExtremes(extents[0], extents[1]);
        },
        setComparison: function(key) {            
            if (!key)
                return;
            
            var lapChart = _globals.charts.laptimes;
            var deltaChart = _globals.charts.delta;

            // laptime chart
            if (lapChart.series.length != 1)
                lapChart.series[1].remove();
            
            lapChart.addSeries({
                name: key,
                data: _globals.sessionCache[key].yLaptimes,
                zIndex: 2,
                color: '#ADBAC7',
                marker: {
                    symbol: 'circle'
                } 
            });
            
            // comparison plotline
            _globals.charts.laptimes.yAxis[0].addPlotLine({
                value: _globals.sessionCache[key].averageLapTimeSeconds,
                color: '#ADBAC7',
                dashStyle: 'ShortDash',
                width: 1,
                zIndex: 3
            });
            
            // delta chart
            _dataset.yDelta = [];
            _dataset.yCumulativeDelta = [];            
            while(deltaChart.series.length > 0)
                deltaChart.series[0].remove();

            for (var i = 0; i < _dataset.yLaptimes.length; i++) {
                var laptime = _dataset.yLaptimes[i];
                var comparisonLaptime = _globals.sessionCache[key].yLaptimes[i];
                var deltaValue = null;
                if (laptime != null && comparisonLaptime != null)
                    deltaValue = _helperFuncs.toDecimalPlaces(comparisonLaptime - laptime, 3);
                _dataset.yDelta.push(deltaValue);

                var prevDeltaValue = (i == 0) ? 0 : _dataset.yCumulativeDelta[_dataset.yCumulativeDelta.length -1];
                _dataset.yCumulativeDelta.push(_helperFuncs.toDecimalPlaces(prevDeltaValue + deltaValue, 3));
            }
            
            deltaChart.addSeries({
                name: 'Lap',
                type: 'column',
                color: '#6DD184',
                negativeColor: '#D16D6D',
                data: _dataset.yDelta
            });

            if (!_dataset.hasLapInconsistency && !_globals.sessionCache[key].hasLapInconsistency) { 
                deltaChart.addSeries({
                    name: 'Cumulative',
                    type: 'line',
                    color: '#ADBAC7',
                    data: _dataset.yCumulativeDelta,
                    zIndex: 10,
                    marker: {
                        symbol: 'circle'
                    } 
                });
            }
            
        }
    }
})(jQuery);