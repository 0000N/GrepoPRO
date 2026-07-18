// ==UserScript==
// @name         GrepoPRO
// @version      1.1.0
// @match        http://*.grepolis.com/game/*
// @match        https://*.grepolis.com/game/*
// @grant        none
// ==/UserScript==

(function() {
    var uw = typeof unsafeWindow != 'undefined' ? unsafeWindow : window;
    var wait = setInterval(function() {
        if (!uw.$ || !uw.gpAjax || !uw.ITowns) return;
        if (document.getElementById('loader')) return;
        clearInterval(wait); init();
    }, 500);

    function init() {
        var $ = uw.$;
        $('<style>').text(
            '#gpro_panel{position:fixed;top:60px;right:10px;width:290px;background:#12121a;border:1px solid #333;border-radius:5px;z-index:2147483647;color:#ddd;pointer-events:auto;font:13px Arial;box-shadow:0 0 15px rgba(0,0,0,.7)}'+
            '#gpro_panel *{pointer-events:auto}'+
            '#gpro_header{background:#1a1a2e;padding:8px 10px;border-radius:5px 5px 0 0;display:flex;justify-content:space-between;align-items:center;user-select:none}'+
            '#gpro_tabs{display:flex;gap:4px;padding:6px 10px;background:#0e0e16;border-bottom:1px solid #222}'+
            '#gpro_tabs span{padding:4px 12px;border-radius:3px;cursor:pointer;font-size:11px;color:#888;background:#1a1a2e}'+
            '#gpro_tabs span.on{background:#ffcc00;color:#000;font-weight:bold}'+
            '#gpro_body{padding:8px}'+
            '.gpro_toggle{width:14px;height:14px;border-radius:50%;background:#555;display:inline-block;cursor:pointer}'+
            '.gpro_toggle.on{background:#4caf50;box-shadow:0 0 6px #4caf50}'+
            '.gpro_row{display:flex;justify-content:space-between;align-items:center;padding:4px 0}'+
            '.gpro_label{font-size:12px;color:#ccc}'+
            '.gpro_status{font-size:12px}'+
            '.gpro_btn{display:inline-block;padding:3px 7px;margin:1px;background:#25253a;color:#ccc;border:1px solid #3a3a55;border-radius:3px;font-size:10px;cursor:pointer}'+
            '.gpro_btn.on{background:#ffcc00;color:#000;font-weight:bold}'+
            '#gpro_info{font-size:10px;color:#666;padding:4px 0;text-align:center}'+
            '#gpro_list{font-size:10px;color:#888;margin-top:2px;max-height:150px;overflow-y:auto}'+
            '#gpro_list div{padding:1px 4px}'+
            '#gpro_list .done{color:#4caf50}#gpro_list .ready{color:#ffcc00}#gpro_list .blocked{color:#555}'
        ).appendTo('head');

        var tab = 'farm';
        var farmOn = false, buildOn = false, running = false;
        var modeBase = 300, modeBoost = 600;
        var intv = null;

        function loadState() {
            try {
                var d = JSON.parse(localStorage.getItem('gpro_state'));
                if (d) { farmOn = d.f || false; buildOn = d.b || false; modeBase = d.m || 300; modeBoost = d.o || 600; }
            } catch(e){}
        }
        function saveState() {
            try { localStorage.setItem('gpro_state', JSON.stringify({f:farmOn, b:buildOn, m:modeBase, o:modeBoost})); } catch(e){}
        }
        loadState(); if (farmOn || buildOn) { intv = setInterval(tick, 1000); tick(); }
        var MODES = [['5min',300,600],['10min',600,1200],['15min',900,1800],['20min',1200,2400],['30min',1800,3600],['45min',2700,5400]];
        var PRIORITY = ['farm','lumber','stonemason','ironer','warehouse','docks','barracks','academy','temple','theater','thermal_baths','library','senate','museum','oracle','wall','tower','hideout','market','workshop'];

        function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }
        function cap() { try { return uw.GameDataPremium.isAdvisorActivated('captain'); } catch(e){} return false; }
        function ajaxGet(c,a,d) { return new Promise(function(r) { uw.gpAjax.ajaxGet(c,a,d||{},false,function(){r();}); }); }
        function ajaxPost(c,a,d) { return new Promise(function(r) { uw.gpAjax.ajaxPost(c,a,d,false,function(){r();}); }); }

        // ---- FARM ----
        function genList() {
            var t = uw.MM.getOnlyCollectionByName('Town').models, islands = {}, i, a, r, p;
            for (i=0; i<t.length; i++) {
                a = t[i].attributes; if (a.on_small_island) continue;
                r = uw.ITowns.getTown(a.id).resources();
                p = Math.min(r.wood,r.stone,r.iron)/r.storage;
                if (!islands[a.island_id] || p < islands[a.island_id][1]) islands[a.island_id]=[a.id,p];
            }
            var list=[]; for (var k in islands) list.push(islands[k][0]); return list;
        }
        function loadFarmData() { return ajaxGet('farm_town_overviews','index').then(function(){return sleep(1500);}); }
        function getFarmTowns() { var c = uw.MM.getOnlyCollectionByName('FarmTown'); return c && c.models ? c.models : []; }
        function getFarmRels() { var c = uw.MM.getOnlyCollectionByName('FarmTownPlayerRelation'); return c && c.models ? c.models : []; }
        function nextLootSec() {
            var m = getFarmRels(), c = {}, i, lt, b = 0, v = 0;
            for (i = 0; i < m.length; i++) { lt = m[i].attributes.lootable_at; if (lt) c[lt] = (c[lt] || 0) + 1; }
            for (var t in c) if (c[t] >= v) { b = t; v = c[t]; }
            var s = b - Math.floor(Date.now() / 1000); return s > 0 ? s : 0;
        }
        function getTownData() {
            var t = uw.ITowns.getCurrentTown(); var booty=0, trade=0;
            try { booty=t.getResearches().attributes.booty?1:0; } catch(e){}
            try { trade=t.getBuildings().attributes.trade_office?1:0; } catch(e){}
            return { island_x:t.getIslandCoordinateX(), island_y:t.getIslandCoordinateY(), current_town_id:t.id, booty_researched:booty, diplomacy_researched:'', trade_office:trade };
        }
        async function doFarm() {
            var polis = genList(); if (!polis.length) return;
            if (cap()) {
                await ajaxGet('farm_town_overviews','index'); await sleep(800);
                await ajaxGet('farm_town_overviews','get_farm_towns_from_multiple_towns',{town_ids:polis}); await sleep(1200);
                await ajaxPost('farm_town_overviews','claim_loads_multiple',{towns:polis, time_option_base:modeBase, time_option_booty:modeBoost, claim_factor:'normal'});
                await ajaxGet('farm_town_overviews','get_farm_towns_for_town',getTownData());
            } else {
                var ft = getFarmTowns(), rl = getFarmRels();
                if (!ft.length || !rl.length) { await loadFarmData(); ft = getFarmTowns(); rl = getFarmRels(); }
                var now = Math.floor(Date.now()/1000);
                var opt = modeBase<=300?1:modeBase<=600?2:modeBase<=900?3:4;
                for (var i = 0; i < polis.length; i++) {
                    var t = uw.ITowns.getTown(polis[i]); if (!t) continue;
                    var x = t.getIslandCoordinateX(), y = t.getIslandCoordinateY();
                    for (var fi = 0; fi < ft.length; fi++) {
                        if (ft[fi].attributes.island_x != x || ft[fi].attributes.island_y != y) continue;
                        for (var ri = 0; ri < rl.length; ri++) {
                            if (ft[fi].attributes.id != rl[ri].attributes.farm_town_id) continue;
                            if (rl[ri].attributes.relation_status !== 1) continue;
                            if (rl[ri].attributes.lootable_at !== null && now < rl[ri].attributes.lootable_at) continue;
                            await ajaxPost('frontend_bridge','execute',{model_url:'FarmTownPlayerRelation/'+rl[ri].id,action_name:'claim',arguments:{farm_town_id:ft[fi].attributes.id,type:'resources',option:opt},town_id:polis[i]});
                            await sleep(600);
                        }
                    }
                }
            }
            setTimeout(function(){ try{uw.WMap.removeFarmTownLootCooldownIconAndRefreshLootTimers();}catch(e){} },2000);
        }

        // ---- BUILD ----
        function getBuildings(townId) { var c = uw.MM.getOnlyCollectionByName('Building'); return c && c.models ? c.models : []; }
        function getQueue() { var c = uw.MM.getOnlyCollectionByName('BuildingQueue'); return c && c.models ? c.models : []; }
        function getRes(townId) { try { return uw.ITowns.getTown(townId).resources(); } catch(e){} return null; }
        function getNextBuild(townId) {
            var blds = getBuildings(townId); var res = getRes(townId); if (!res) return null;
            for (var p = 0; p < PRIORITY.length; p++) {
                for (var i = 0; i < blds.length; i++) {
                    var a = blds[i].attributes;
                    if (a.type !== PRIORITY[p] || a.is_max_level) continue;
                    if (res.wood < (a.upgrade_cost||{}).wood || res.stone < (a.upgrade_cost||{}).stone || res.iron < (a.upgrade_cost||{}).iron) continue;
                    return blds[i];
                }
            }
            return null;
        }
        async function doBuild() {
            var towns = uw.MM.getOnlyCollectionByName('Town').models;
            for (var ti = 0; ti < towns.length; ti++) {
                var t = towns[ti].attributes;
                if (t.on_small_island || getQueue().length) continue;
                var bld = getNextBuild(t.id);
                if (!bld) continue;
                await ajaxPost('frontend_bridge','execute',{model_url:'Building/'+bld.id,action_name:'upgrade',arguments:{},town_id:t.id});
                await sleep(2000);
            }
        }

        // ---- UI ----
        function render() {
            var body = $('#gpro_body');

            if (tab === 'farm') {
                var fs = farmOn ? 'Prete' : 'Arrete';
                var fc = farmOn ? '#4caf50' : '#888';
                if (farmOn) {
                    var sec = nextLootSec();
                    if (running) { fs = 'Collecte...'; fc = '#4fc3f7'; }
                    else if (sec <= 0) { fs = 'Prete'; fc = '#4caf50'; }
                    else { var m = Math.floor(sec/60), s = sec%60; fs = m+'m '+s+'s'; fc = '#ffcc00'; }
                }
                var mh = '';
                for (var i = 0; i < MODES.length; i++) mh += '<span class="gpro_btn'+(modeBase===MODES[i][1]?' on':'')+'" data-b="'+MODES[i][1]+'" data-o="'+MODES[i][2]+'">'+MODES[i][0]+'</span>';
                body.html(
                    '<div class="gpro_row"><span class="gpro_label">Farm</span><span class="gpro_toggle'+(farmOn?' on':'')+'" data-mod="farm"></span></div>'+
                    '<div class="gpro_row" style="flex-wrap:wrap">'+mh+'</div>'+
                    '<div class="gpro_row"><span class="gpro_label">Prochaine</span><span class="gpro_status" style="color:'+fc+'">'+fs+'</span></div>'+
                    '<div class="gpro_row"><span class="gpro_label">Capitaine</span><span class="gpro_status">'+(cap()?'Oui':'Non')+'</span></div>'+
                    '<div id="gpro_info">'+uw.ITowns.towns.length+' villes</div>'
                );
                body.find('.gpro_toggle[data-mod="farm"]').click(function(){ farmOn = !farmOn; saveState(); if (!farmOn && intv) { clearInterval(intv); intv=null; } else if (farmOn && !intv) { intv=setInterval(tick,1000); tick(); } render(); });
                body.find('.gpro_btn').click(function(){ modeBase = parseInt($(this).data('b')); modeBoost = parseInt($(this).data('o')); saveState(); render(); });

            } else {
                var q = getQueue();
                var bs = buildOn ? 'Actif' : 'Arrete';
                var bc = buildOn ? '#4caf50' : '#888';
                if (buildOn && running) { bs = 'Construction...'; bc = '#4fc3f7'; }
                else if (buildOn && q.length) { bs = 'File: '+q.length; bc = '#ffcc00'; }
                else if (buildOn) { var nb = getNextBuild(uw.ITowns.getCurrentTown().id); bs = nb ? 'Prete' : 'Tout MAX'; bc = nb ? '#4caf50' : '#888'; }

                var lh = '';
                var blds = getBuildings(uw.ITowns.getCurrentTown().id);
                for (var i = 0; i < Math.min(blds.length, 30); i++) {
                    var a = blds[i].attributes;
                    var cls = a.is_max_level ? 'done' : (a.level === 0 ? 'blocked' : 'ready');
                    lh += '<div class="'+cls+'">'+a.type+' lv'+a.level+(a.is_max_level?' MAX':'')+'</div>';
                }
                body.html(
                    '<div class="gpro_row"><span class="gpro_label">Build</span><span class="gpro_toggle'+(buildOn?' on':'')+'" data-mod="build"></span></div>'+
                    '<div class="gpro_row"><span class="gpro_label">Statut</span><span class="gpro_status" style="color:'+bc+'">'+bs+'</span></div>'+
                    '<div class="gpro_row"><span class="gpro_label">File</span><span class="gpro_status">'+q.length+'</span></div>'+
                    '<div id="gpro_list">'+lh+'</div>'+
                    '<div id="gpro_info">'+uw.ITowns.towns.length+' villes</div>'
                );
                body.find('.gpro_toggle[data-mod="build"]').click(function(){ buildOn = !buildOn; saveState(); if (!buildOn && intv) { clearInterval(intv); intv=null; } else if (buildOn && !intv) { intv=setInterval(tick,3000); tick(); } render(); });
            }
        }

        function tick() {
            if (!farmOn && !buildOn) { clearInterval(intv); intv=null; render(); return; }
            if ($('.botcheck').length || $('#recaptcha_window').length) { render(); return; }
            if (running) return;
            running = true;
            Promise.resolve().then(async function() {
                if (farmOn) {
                    var sec = nextLootSec();
                    if (sec <= 0) await doFarm();
                }
                if (buildOn && !getQueue().length) {
                    await doBuild();
                }
            }).then(function() { running = false; render(); }).catch(function() { running = false; render(); });
        }

        var p = $('<div id="gpro_panel"><div id="gpro_header"><b style="color:#ffcc00">GrepoPRO</b><span style="font-size:10px;color:#888">v1.1.0</span></div><div id="gpro_tabs"><span data-t="farm">Farm</span><span data-t="build">Build</span></div><div id="gpro_body"></div></div>');
        $('body').append(p);
        $('#gpro_tabs span').click(function(){ tab = $(this).data('t'); $('#gpro_tabs span').removeClass('on'); $(this).addClass('on'); render(); });
        $('#gpro_tabs span:first').addClass('on');
        render();
    }
})();
