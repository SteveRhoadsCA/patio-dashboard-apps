Ext.define("TSDeliveryEfficiency", {
    extend: 'CA.techservices.app.ChartApp',

    description: "<strong>Delivery Efficiency</strong><br/>" +
            "<br/>" +
            "This chart can help teams understand where time is being spent while delivering value. " +
            "This dashboard allows teams to identify how efficiently they are working to deliver an " +
            "accepted point of each of the different types.  (Your admin can choose a different field to define " +
            "'type' with the App Settings... menu option.)" +
            "<p/>" +
            "Click on a bar or point on the line to see a table with the accepted items from that timebox." +
            "<p/>" +
            "The efficiency is calculated by finding Tasks of each type and dividing the total of estimates in hours by actuals.  This is averaged for each sprint.",
    
    integrationHeaders : {
        name : "TSDeliveryAcceleration"
    },
    
    config: {
        defaultSettings: {
            showPatterns: false,
            typeField: null
        }
    },
                        
    launch: function() {
        this.callParent();
        
        if ( Ext.isEmpty(this.getSetting('typeField')) ) { 
            Ext.Msg.alert('Configuration Note', 'Use the App Settings item on the gear menu to set the field that defines task type.');
            return;
        }
        
        this._getAllowedValues('Task',this.getSetting('typeField')).then({
            scope: this,
            success: function(values) {
                this.allowed_types = values;
                this._addSelectors();
                this._updateData();
            },
            failure: function(msg) {
                Ext.Msg.alert('Problem loading allowed values', msg);
            }
        });
    }, 

    _addSelectors: function() {

        this.timebox_limit = 10;
        this.addToBanner({
            xtype: 'numberfield',
            name: 'timeBoxLimit',
            itemId: 'timeBoxLimit',
            fieldLabel: 'Time Box Limit',
            value: 10,
            maxValue: 20,
            minValue: 1,            
            margin: '0 0 0 50',
            width: 150,
            allowBlank: false,  // requires a non-empty value
            listeners:{
                change:function(nf){
                    this.timebox_limit = nf.value;
                    this._updateData();
                },
                scope:this
            }
        }
        );

        this.timebox_type = 'Iteration';
        this.addToBanner(
        {
            xtype      : 'radiogroup',
            fieldLabel : 'Timebox Type',
            margin: '0 0 0 50',
            width: 300,
            defaults: {
                flex: 1
            },
            layout: 'hbox',
            items: [
                {
                    boxLabel  : 'Iteration',
                    name      : 'timeBoxType',
                    inputValue: 'Iteration',
                    id        : 'radio1',
                    checked   : true                    
                }, {
                    boxLabel  : 'Release',
                    name      : 'timeBoxType',
                    inputValue: 'Release',
                    id        : 'radio2'
                }
            ],
            listeners:{
                change:function(rb){
                    this.timebox_type = rb.lastValue.timeBoxType;
                    this._updateData();
                },
                scope:this
            }
        }
        );


    },    
    
    _getAllowedValues: function(model, field_name) {
        var deferred = Ext.create('Deft.Deferred');

        this.logger.log("_getAllowedValues for", model, field_name);
        
        Rally.data.ModelFactory.getModel({
            type: model,
            success: function(model) {
                model.getField(field_name).getAllowedValueStore().load({
                    callback: function(records, operation, success) {
                        var values = Ext.Array.map(records, function(record) {
                            return record.get('StringValue');
                        });
                        deferred.resolve(values);
                    }
                });
            },
            failure: function(msg) { deferred.reject('Error loading field values: ' + msg); }
        });
        return deferred;
    },
    
    _updateData: function() {
        var me = this;
        this.metric = "size";
        //this.timebox_type = 'Iteration';
        
        Deft.Chain.pipeline([
            this._fetchTimeboxes,
            this._sortIterations,
            this._fetchArtifactsInTimeboxes
        ],this).then({
            scope: this,
            success: function(results) {
                
						this._sortTasks(results);

            var artifacts_by_timebox = this._collectArtifactsByTimebox(results || []);
                
            this.clearAdditionalDisplay();

            this._makeGrid(artifacts_by_timebox);

            this._makeChart(artifacts_by_timebox);
            
            },
            failure: function(msg) {
                Ext.Msg.alert('--', msg);
            }
        });
        
    },

    _fetchTimeboxes: function() {
        var me = this,
            deferred = Ext.create('Deft.Deferred'),
            type = this.timebox_type;
                
        this.setLoading("Fetching timeboxes...");

        var start_field = "StartDate";
        var end_field = "EndDate";

        if ( type == "Release" ) {
            start_field = "ReleaseStartDate";
            end_field   = "ReleaseDate";
        }        
                
        var config = {
            model: type,
            limit: this.timebox_limit,
            pageSize: this.timebox_limit,
            fetch: ['Name',start_field,end_field],
            filters: [{property:end_field, operator: '<=', value: Rally.util.DateTime.toIsoString(new Date)}],
            sorters: [{property:end_field, direction:'DESC'}],
            context: {
                projectScopeUp: false,
                projectScopeDown: false
            }
        };
        
        return TSUtilities.loadWsapiRecords(config);
    },
    
    _sortIterations: function(iterations) {
        
        // Ext.Array.sort(iterations, function(a,b){
        //     if ( a.get('EndDate') < b.get('EndDate') ) { return -1; }
        //     if ( a.get('EndDate') > b.get('EndDate') ) { return  1; }
        //     return 0;
        // });
        
        return iterations.reverse();
    },
    
    _sortTasks: function(task_records) {
    	
			var end_date_field = TSUtilities.getEndFieldForTimeboxType(this.timebox_type);
        
			for (i=0; i < task_records.length; i++) { 
				task_records[i].task_sort_field = task_records[i]['data'][this.timebox_type][end_date_field];
				};
     
      Ext.Array.sort(task_records, function(a,b){      	
      	if ( a.task_sort_field < b.task_sort_field ) { return -1; }
        if ( a.task_sort_field > b.task_sort_field ) { return  1; }
        return 0;
        }); 
        
        return task_records;

    },
    
   _fetchArtifactsInTimeboxes: function(timeboxes) {
        if ( timeboxes.length === 0 ) { 
        	  Ext.Msg.alert('', 'No Timeboxes of selected type for selected Project');
            return;
				}
        
        var type = this.timebox_type;
        var type_field = this.getSetting('typeField');
        
        var start_field = "StartDate";
        var end_field = "EndDate";
        if ( type == "Release" ) {
            start_field = "ReleaseStartDate";
            end_field   = "ReleaseDate";
        }
        
        //var deferred = Ext.create('Deft.Deferred');
        var first_date = timeboxes[0].get(start_field);
        var last_date = timeboxes[timeboxes.length - 1].get(end_field);
        
        var filters = [
            {property: type + '.' + start_field, operator: '>=', value:first_date},
            {property: type + '.' + end_field, operator: '<=', value:last_date},
            //{property:'AcceptedDate', operator: '!=', value: null }
            {property:'WorkProduct.AcceptedDate', operator: '!=', value: null }
        ];

        
        var config = {
            //model:'HierarchicalRequirement',
            model: 'Task',
            limit: Infinity,
            filters: filters,
            fetch: ['ObjectID','FormattedID','Name','State','Actuals','Estimate','ToDo',
                'WorkProduct','PlanEstimate','Tasks','TaskActualTotal','TaskEstimateTotal',
                'ScheduleState','Project',type_field,
                'Iteration','Release','StartDate','EndDate',
                'ReleaseStartDate','ReleaseDate'],

        };
        
        return TSUtilities.loadWsapiRecords(config);

        // Deft.Chain.sequence([
        //     function() { 
        //         return TSUtilities.loadWsapiRecords(config);
        //     },
        //     function() {
        //         config.model = "Defect";
        //         return TSUtilities.loadWsapiRecords(config);
        //     },
        //     function() {
        //         config.model = "TestSet";
        //         return TSUtilities.loadWsapiRecords(config);
        //     },
        //     function() {
        //         config.model = "DefectSuite";
        //         return TSUtilities.loadWsapiRecords(config);
        //     }
        // ],this).then({
        //     success: function(results) {
        //         deferred.resolve(Ext.Array.flatten(results));
        //     },
        //     failure: function(msg) {
        //         deferred.reject(msg);
        //     }
        // });
        //return deferred.promise;
    },
    
    /* 
     * returns a hash of hashes -- key is iteration name value is
     * another hash where the records key holds a hash
     *    the records hash has a key for each allowed value 
     *    which then provides an array of items that match the allowed value 
     *    and timebox
     * as in
     * { "iteration 1": { "records": { "all": [o,o,o], "SPIKE": [o,o], "": [o] } } }
     */
    _collectArtifactsByTimebox: function(items) {
    	
//this.logger.log("in CAT", items);    	
    	
        var hash = {},
            timebox_type = this.timebox_type,
            type_field = this.getSetting('typeField'),
            allowed_types = this.allowed_types;
        
        
        if ( items.length === 0 ) { return hash; }
        
        var base_hash = {
            records: {
                all: []
            }
        };
        Ext.Array.each(allowed_types, function(value) {
            base_hash.records[value] = [];
        });
        
        Ext.Array.each(items, function(item){
            var timebox = item.get(timebox_type).Name;
            
            if ( Ext.isEmpty(hash[timebox])){
                
                hash[timebox] = Ext.Object.merge({}, Ext.clone(base_hash) );
            }
            hash[timebox].records.all.push(item);
            
            var type = item.get(type_field) || "";
            if ( Ext.isEmpty(hash[timebox].records[type]) ) {
                hash[timebox].records[type] = [];
            }
            hash[timebox].records[type].push(item);
        });
 
//this.logger.log("out CAT", hash);
        
        return hash;
    },
    
     _makeGrid: function(artifacts_by_timebox) {
        var me = this;
        
        var columns = [{dataIndex:'Name',text:'Task Type',flex:1}];
        Ext.Array.each(this._getCategories(artifacts_by_timebox), function(field){
            columns.push({  dataIndex: me._getSafeIterationName(field) + "_number", 
                            text: field + '---<p/> Act Hours / Est Hours', 
                            align: 'center',
                            flex:1,
                            renderer: function(value,meta,record) {
                                //if(value.actual_hours_total > 0){
                                    return value.actual_hours_total + " / " + value.estimate_hours_total;
                                //}
                            }
                        });
        });
       
        var rows = this._getGridRows(artifacts_by_timebox);
        
        var store = Ext.create('Rally.data.custom.Store',{ data: rows });

        this.addToAdditionalDisplay({
            xtype:'rallygrid',
            padding: 5,
            margin: '10 0 0 0',
            showPagingToolbar: false,
            enableEditing: false,
            showRowActionsColumn: false,                
            store: store,
            columnCfgs: columns
        }); 

    },
    
    _getGridRows: function(artifacts_by_timebox) {
        var me = this;
        // sprint objects have key = name of sprint
        var row_fields = this._getCategories(artifacts_by_timebox);
        
        var series = this._getSeries(artifacts_by_timebox);

        var rows = [
        ];

        Ext.Array.each(this._getSeries(artifacts_by_timebox),function(rowname){
            rows.push({Type:rowname.name == "-N/A-" ? '':rowname.name,Name:rowname.name});
        })

        // set up fields
        
        Ext.Array.each(rows, function(row) {
            Ext.Array.each(row_fields, function(field){
                field = me._getSafeIterationName(field);
                row[field] = [];
                row[field + "_number"] = 0;
            });
        });
                
        Ext.Array.each(rows, function(row){
            var type = row.Type;

            Ext.Object.each(artifacts_by_timebox, function(sprint_name,value){
                sprint_name = me._getSafeIterationName(sprint_name);

                row[sprint_name] = value.records[type];

                var all_records = value.records['all'];

                var actual_hours_total = 0;
                var estimate_hours_total = 0;

/*
                Ext.Array.each(all_records, function(story){
                    var value = story.get('Actuals') || 0;
                    all_actual_hours_total = all_actual_hours_total + value;
                });  
*/
                Ext.Array.each(row[sprint_name], function(story){
                    var a_value = story.get('Actuals') || 0;
                    var e_value = story.get('Estimate') || 0;
                    actual_hours_total = actual_hours_total + a_value;
                    estimate_hours_total = estimate_hours_total + e_value;
                });                
                               
//                var actual_hours_pct = all_actual_hours_total > 0?Math.round((actual_hours_total / all_actual_hours_total)*100)/100:0;
                row[sprint_name + "_number"] = {'actual_hours_total':actual_hours_total, 'estimate_hours_total':estimate_hours_total}; 
                
            });
        });

        return rows;
    },

    _getSafeIterationName: function(name) {
        return name.replace(/\./,'&#46;'); 
    },
     
   _makeChart: function(artifacts_by_timebox) {
        var me = this;

        var categories = this._getCategories(artifacts_by_timebox);
        var series = this._getSeries(artifacts_by_timebox);
        var colors = CA.apps.charts.Colors.getConsistentBarColors();
        
        if ( this.getSetting('showPatterns') ) {
            colors = CA.apps.charts.Colors.getConsistentBarPatterns();
        }
        this.setChart({
            chartData: { series: series, categories: categories },
            chartConfig: this._getChartConfig(),
            chartColors: colors
        });
        this.setLoading(false);
    },
    
    _getSeries: function(artifacts_by_timebox) {
        var series = [],
            allowed_types = this.allowed_types;
        
        Ext.Array.each(allowed_types, function(allowed_type){
            var name = allowed_type;
            if ( Ext.isEmpty(name) ) { name = "-N/A-"; }
            
            series.push({
                name: name,
                data: this._calculateMeasure(artifacts_by_timebox,allowed_type),
                type: 'column',
                stack: 'a'
            });
        },this);
        
        return series;
    },
    
    _calculateMeasure: function(artifacts_by_timebox,allowed_type) {
        var me = this,
        data = [];

        Ext.Object.each(artifacts_by_timebox, function(timebox, value){
            var records = value.records[allowed_type] || [];

						var unique = {};
						var points = 0;

						records.forEach(function (record) {

						  if (!unique[record.get('WorkProduct').FormattedID]) {

						    points += record.get('WorkProduct').PlanEstimate;
						    unique[record.get('WorkProduct').FormattedID] = true;
						  }

						});

/*
            var points = Ext.Array.sum(
                Ext.Array.map(records, function(record){
                    return record.get('WorkProduct').PlanEstimate || 0;
                })
            );
*/            
            var actuals = Ext.Array.sum(
                Ext.Array.map(records, function(record){
                    return record.get('Actuals') || 0;
                })
            );

            var estimate = Ext.Array.sum(
                Ext.Array.map(records, function(record){
                    return record.get('Estimate') || 0;
                })
            );
            
            var a_efficiency = e_efficiency = null;
            if ( points > 0 ) {
                e_efficiency = estimate/points;
            }
            if ( points > 0 ) {
                a_efficiency = actuals/points;
            }

            data.push({ 
                y:e_efficiency,
                _records: records,
                events: {
                    click: function() {
                        me.showDrillDown(this._records,  timebox + " - " + points + " points (" + allowed_type + ")");
                    }
                }
            });


        });

        return data
    },

   
    _getCategories: function(artifacts_by_timebox) {
        return Ext.Object.getKeys(artifacts_by_timebox);
    },
    
    _getChartConfig: function() {
        var me = this;
        return {
            chart: { type:'column' },
            title: { text: 'Delivery Efficiency' },
            xAxis: {},
            yAxis: [{ 
                title: { text: 'Task Estimates per Story Point (by Task Type)' }
//                title: { text: 'Task Actuals per Story Point (by Task Type)' }
            }],
            plotOptions: {
                column: {
                    stacking: 'normal'
                }
            },
            tooltip: {
                formatter: function() {
                    return '<b>'+ this.series.name +'</b>: '+ Ext.util.Format.number(this.point.y, '0.##');
                }
            }
        }
    },
    
    getSettingsFields: function() {
        return [
        {
            name: 'typeField',
            xtype: 'rallyfieldcombobox',
            model: 'Task',
            _isNotHidden: function(field) {
                if ( field.hidden ) { return false; }
                var defn = field.attributeDefinition;
                if ( Ext.isEmpty(defn) ) { return false; }
                
                return ( defn.Constrained && defn.AttributeType == 'STRING' );
            }
        },
        { 
            name: 'showPatterns',
            xtype: 'rallycheckboxfield',
            boxLabelAlign: 'after',
            fieldLabel: '',
            margin: '0 0 25 25',
            boxLabel: 'Show Patterns<br/><span style="color:#999999;"><i>Tick to use patterns in the chart instead of color.</i></span>'
        }
        
        ];
    },
    
    getDrillDownColumns: function(title) {
        var columns = [
            {
                dataIndex : 'FormattedID',
                text: "id",
                flex: 1
            },
            {
                dataIndex : 'Name',
                text: "Name",
                flex: 2
            },
            {
                dataIndex: 'WorkProduct',
                text: 'Work Product',
                flex: 2,
                renderer: function(value,meta,record) {
                    if ( Ext.isEmpty(value) ) { return ""; }
                    return value.FormattedID + ": " + value.Name;
                }
            },
            {
                dataIndex: 'WorkProduct',
                text: 'Story Points',
                flex: 1,
                renderer: function(value,meta,record) {
                    if ( Ext.isEmpty(value) ) { return ""; }
                    return value.PlanEstimate;
                }
            },
            {
                dataIndex: 'Estimate',
                text: 'Task Hours (Estimate)',
                flex: 1
            },
            {
                dataIndex: 'Actuals',
                text: 'Task Hours (Actual)',
								flex: 1
            },
            {
                dataIndex: 'Project',
                text: 'Project',
                renderer:function(Project){
                        return Project.Name;
                },
                flex: 1
            }
        ];
        
        if ( /\(multiple\)/.test(title)) {
            columns.push({
                dataIndex: 'Name',
                text: 'Count of Moves',
                renderer: function(value, meta, record) {
                    
                    return value.split('[Continued]').length;
                }
            });
        }
        
        
        return columns;
    }
    
});
