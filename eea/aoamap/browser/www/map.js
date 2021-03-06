(function($) {

var M = window.M = {};


M.i18n_messages = {};
$('.aoa-i18n').each(function() {
  var msg = $(this);
  M.i18n_messages[msg.attr('name')] = msg.text();
});

M._ = function(msg_id) {
  var translated = M.i18n_messages[msg_id];
  if(translated == null) {
    translated = "[Missing translation: " + msg_id + "]";
  }
  return translated;
};


Proj4js.defs["LONG_LAT_8K"] = "+proj=longlat +units=degrees " +
                                  "+a=8000000 +b=8000000";
Proj4js.defs["LAEA_52N_65E_8K"] = "+proj=laea +lat_0=52 +lon_0=65 " +
                                  "+a=8000000 +b=8000000";

M.proj_long_lat = new OpenLayers.Projection("LONG_LAT_8K");
M.map_projection = new OpenLayers.Projection("LAEA_52N_65E_8K");
M.project = function(point) {
  return point.clone().transform(M.proj_long_lat, M.map_projection);
};
M.map_extent = new OpenLayers.Bounds(-8441336, -3173340, 6315323, 6948737);
M.country_code = {};

M.format_date = function(date) {
  return "" + date.getFullYear() + "-" +
         zeropad(date.getMonth()+1, 2) + "-" +
         zeropad(date.getDate(), 2) + " " +
         zeropad(date.getHours(), 2) + ":" +
         zeropad(date.getMinutes(), 2);

  function zeropad(value, n) {
    var s = "" + value;
    while(s.length < n) {
      s = "0" + s;
    }
    return s;
  }
};

M.docs_summary_result = $.Deferred();

M.xyz_layer = function(label) {
  var url_pattern = M.config['tiles_url'] + "aoa-" + M.config['language'] +
                    "/${z}/${x}/${y}.png" + M.config['map_rev'];
  return new OpenLayers.Layer.XYZ(label, url_pattern,
    {'sphericalMercator': true, 'numZoomLevels': 7}
  );
};

M.selection_changed = function() {
  $(M.countries_map.div).trigger('map-selection-changed');
};

M.templates = {};
M.load_templates = function() {
  $('.jquery-template').each(function(n, tmpl_div) {
    var tmpl_div = $(this);
    var name = tmpl_div.attr('id');
    M.templates[name] = tmpl_div;
    tmpl_div.remove().template();
  });
};

M.views = {};
M.add_view = function(name, tiles_layer) {
  var this_view = M.views[name] = {'name': name};

  this_view.tiles_layer = tiles_layer;
  M.countries_map.addLayer(this_view.tiles_layer);

  this_view.polygons_layer = new OpenLayers.Layer.Vector(
    this_view.name + ' - polygons',
    {displayInLayerSwitcher: false,
     visibility: false,
     styleMap: new OpenLayers.StyleMap({
      'default': new OpenLayers.Style({
        'cursor': 'pointer',
        'fillOpacity': 0,
        'strokeOpacity': 0,
        'fontSize': 12,
        'fontWeight': 'bold',
        'label': "${count}"
      }),
      'select': new OpenLayers.Style({
        'fillOpacity': 0.4
      })
    })});

  this_view.set_features = function(polygons_data) {
      $.each(polygons_data, function(n, poly) {
        poly.attributes['count'] = "";
      });
      this_view.polygons_layer.addFeatures(polygons_data);
      M.countries_map.addLayer(this_view.polygons_layer);
  };

  this_view.select_polygon = new OpenLayers.Control.SelectFeature(
    this_view.polygons_layer, {
      'multiple': true,
      'toggle': true,
      'clickout': false,
      'onSelect': M.selection_changed,
      'onUnselect': M.selection_changed
    });
  this_view.select_polygon.handlers.feature.stopDown = false;
  M.countries_map.addControl(this_view.select_polygon);

  this_view.update_visibility = function() {
    var visibility = this_view.tiles_layer.getVisibility();
    this_view.polygons_layer.setVisibility(visibility);
    var select_control = this_view.select_polygon;
    if(this_view.tiles_layer.getVisibility()) {
      select_control.activate();
      select_control.unselectAll();
      M.current_view_name = this_view.name;
      this_view.polygons_layer.redraw();
    } else {
      select_control.deactivate();
    }
  }

  this_view.update_document_counts = function(docs_and_countries) {
    $.each(this_view.polygons_layer.features, function(n, feature) {
      var count = 0;
      var feature_countries = feature.attributes['countries'];
      $.each(docs_and_countries, function(m, document_countries) {
        // for each document, see if any country matches this feature
        for(var i = 0; i < document_countries.length; i++) {
          var country = document_countries[i];
          if($.inArray(country, feature_countries) > -1) {
            // we have a match. count it and go to next document.
            count += 1;
            return;
          }
        }
      });
      if(! count) {
        count = "";
      }
      feature.attributes['count'] = count;
    });
    this_view.polygons_layer.redraw();
  };

  this_view.tiles_layer.events.on({
    'visibilitychanged': this_view.update_visibility
  });

  if(M.countries_map.baseLayer !== this_view.tiles_layer) {
    this_view.tiles_layer.setVisibility(false);
  }
  this_view.update_visibility();
}

M.get_current_view = function() {
  return M.views[M.current_view_name];
}

M.get_selected_countries = function() {
  var layer = M.get_current_view().polygons_layer;
  var countries = [];
  $.each(layer.selectedFeatures, function(n, feature) {
    $.merge(countries, feature.attributes['countries']);
  });
  return countries;
};

M.get_selected_regions = function() {
  if(M.current_view_name != 'region') return [];
  var layer = M.get_current_view().polygons_layer;
  return $.map(layer.selectedFeatures, function(feature) {
    return feature.attributes['name'];
  });
};

M.deselect_all_polygons = function() {
  M.get_current_view().select_polygon.unselectAll();
};

M.update_all_document_counts = function(docs_and_countries) {
  $.each(M.views, function(i, view) {
    view.update_document_counts(docs_and_countries);
  });
};

M.geojson_format = new OpenLayers.Format.GeoJSON({
  'internalProjection': M.map_projection,
  'externalProjection': M.proj_long_lat
});

M.load_features = function(name, callback) {
  $.get(M.config['www_prefix'] + '/' + name, callback);
};

M.set_up_country_coverage_layer = function() {
  M.country_coverage_screening_layer = new OpenLayers.Layer.Image(
    "Country coverage screen", M.config['www_prefix'] + '/map-dimming.png',
    M.map_extent, new OpenLayers.Size(2, 2));
  M.countries_map.addLayer(M.country_coverage_screening_layer);

  M.country_coverage_layer = new OpenLayers.Layer.Vector(
    "Country coverage",
    {displayInLayerSwitcher: false,
     visibility: false,
     styleMap: new OpenLayers.StyleMap({
      'default': new OpenLayers.Style({
        'fillColor': "#540",
        'fillOpacity': 0.6,
        'strokeWidth': 0
      })
    })});
  M.countries_map.addLayer(M.country_coverage_layer);

  var ClickControl = OpenLayers.Class(OpenLayers.Control, {
      clickHandler: function() {},

      initialize: function(clickHandler) {
          OpenLayers.Control.prototype.initialize.apply(this, []);
          if(clickHandler) this.clickHandler = clickHandler;
          this.handler = new OpenLayers.Handler.Click(
              this, {'click': this.trigger}, {'delay': 0});
      },

      trigger: function(e) {
          this.clickHandler(e.xy);
      }
  });
  M.country_coverage_click_control = new ClickControl(M.hide_country_coverage);
  M.countries_map.addControl(M.country_coverage_click_control);
};

M.hide_country_coverage = function() {
  if(M.country_coverage_click_control == null) return;
  M.country_coverage_click_control.deactivate();
  M.country_coverage_layer.setVisibility(false);
  M.country_coverage_screening_layer.setVisibility(false);
  M.get_current_view().polygons_layer.setVisibility(true);
  $(M.countries_map.div).trigger('map-coverage-hidden');
}

M.show_country_coverage = function(countries) {
  M.get_current_view().polygons_layer.setVisibility(false);
  M.country_coverage_layer.removeAllFeatures();
  $.each(M.all_country_features, function(n, feature) {
    var country_name = feature.attributes['countries'][0];
    if($.inArray(country_name, countries) > -1) {
      M.country_coverage_layer.addFeatures([feature]);
    }
  });
  M.country_coverage_layer.setVisibility(true);
  M.country_coverage_screening_layer.setVisibility(true);
  M.country_coverage_click_control.activate();
};

M.get_layer_labels = function() {
  M.layer_label = {};
  var trans = $('div.translations', M.map_div);
  $.each(['country', 'region', 'global'], function(i, name) {
    M.layer_label[name] = $('span#map-label-'+name, trans).text();
  });
  trans.remove();
};

M.after_map_load_queue = [];
M.after_map_load = function(callback) {
  if(M.after_map_load_queue == null) {
    callback();
  } else {
    M.after_map_load_queue.push(callback);
  }
};

M.map_has_loaded = function() {
  var i = 0;
  while(M.after_map_load_queue.length > 0) {
    var callback = M.after_map_load_queue.splice(0, 1)[0];
    callback();
  }
  M.after_map_load_queue = null;
};

M.create_map_search = function() {
  M.countries_map = new OpenLayers.Map(M.map_div[0].id, {
    restrictedExtent: M.map_extent,
    controls: [
      new OpenLayers.Control.Navigation(),
      new OpenLayers.Control.ZoomPanel()
    ]
  });

  $.each(['country', 'region', 'global'], function(i, name) {
    M.add_view(name, M.xyz_layer(M.layer_label[name]));
  });

  M.countries_map.events.on({
    'changebaselayer': function() {
      M.hide_country_coverage();
      $.each(M.views, function(name, view) {
        view.update_visibility();
      });
      M.selection_changed();
      M.map_div.trigger('map-layer-changed');
    }
  });

  M.countries_map.isValidZoomLevel = function(zoom) {
    return (zoom > 2 && zoom < 7);
  };
  M.countries_map.zoomToMaxExtent = function() {
    M.countries_map.setCenter(M.project(new OpenLayers.LonLat(50, 63)), 3);
  };
  M.countries_map.zoomToMaxExtent();

  M.load_features('countries.json', function(features_json) {
    var view = M.views["country"];
    view.set_features(M.geojson_format.read(features_json));

    // parse the JSON twice so we get different IDs for the features
    M.all_country_features = M.geojson_format.read(features_json);
    M.set_up_country_coverage_layer();
  });

  M.load_features('regions.json', function(features_json) {
    var view = M.views["region"];
    view.set_features(M.geojson_format.read(features_json));
  });
  M.map_has_loaded();
};

M.create_map_document = function(options) {
  M.document_map = new OpenLayers.Map(options['map_div'], {controls: []});
  M.document_map.addLayer(M.xyz_layer("Background"));
  M.document_map.setCenter(M.project(new OpenLayers.LonLat(30, 57)), 2);

  M.load_features('countries.json', function(features_json) {
    M.countries_layer = new OpenLayers.Layer.Vector(
      'Countries',
      {styleMap: new OpenLayers.StyleMap({
        'default': new OpenLayers.Style({
          'fillOpacity': 0.7,
          'fillColor': '#000',
          'strokeOpacity': 0
        })
      })});
    M.document_map.addLayer(M.countries_layer);

    var countries = M.config['document_countries'];
    $.each(M.geojson_format.read(features_json), function(n, country_poly) {
      if($.inArray(country_poly['attributes']['name'], countries) > -1) {
        M.countries_layer.addFeatures([country_poly]);
      }
    });
  });
};

})(jQuery);
